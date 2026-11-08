import {RMS,LUFS,Levels,SyllableCounter,yin,autocorrelation,rms,db,calibration,trace,percentile,mean} from './dsp.mjs';
import {decodeWav,encodeWav} from './wav.mjs';
import {renderLoop,scheduleProgression,jitterTest} from './sound.mjs';
const $=s=>document.querySelector(s),stage=document.body.dataset.stage;
const names={a:'Captura: constraints y rutas de análisis',b:'Energía y calibración',c:'Velocidad: picos de envolvente',d:'Pitch: cuatro alternativas',e:'Motor: reloj y planificación',f:'Sonido: síntesis y loops',g:'Contaminación por música propia'};
document.title=names[stage];
document.body.innerHTML=`<nav><a href="../index.html">← Experimentos</a><a href="./RESULTADOS.md">Resultados Node</a><a href="./resultados.json">JSON</a></nav><h1>${stage.toUpperCase()} · ${names[stage]}</h1>
<p>Fixtures sintéticos PCM16 mono a 48 kHz. El micrófono necesita localhost o HTTPS. En tablet por LAN, WAV funciona mediante HTTP; micrófono requiere HTTPS. Las métricas del dispositivo aparecen al iniciar una entrada.</p>
<section class="panel"><h2>Entrada</h2><label><input id="constraints" type="checkbox">AEC + supresión de ruido + AGC</label><button id="mic">Micrófono real</button><button id="stop">Detener</button><br>
<select id="fixture" aria-label="WAV de prueba">${['sermon-simulado.wav','voz-normal.wav','voz-rapida.wav','voz-lenta.wav','sermon-con-musica.wav','musica-sola.wav','calibracion.wav','tonos.wav'].map(f=>`<option>${f}</option>`).join('')}</select><button id="load">Cargar WAV de test-audio</button><label>Otro WAV <input id="file" type="file" accept=".wav,audio/wav"></label><label><input id="listen" type="checkbox">Escuchar WAV</label><p id="status" class="status">Sin entrada activa.</p><canvas id="wave" width="1000" height="160"></canvas></section>
<section class="grid" id="metrics"></section><section class="panel" id="specific"></section><section class="panel"><h2>Resultados medidos en Node</h2><pre id="offline">Cargando…</pre></section><details><summary>Registro del dispositivo</summary><pre id="log"></pre></details>`;
function metric(label,value){let el=document.getElementById('metric-'+label);if(!el){el=document.createElement('div');el.className='metric';el.id='metric-'+label;$('#metrics').append(el);}el.textContent=label;const b=document.createElement('strong');b.textContent=value;el.append(b);}
const fmt=(v,d=2)=>Number.isFinite(v)?v.toFixed(d):'no disponible';
function log(v){$('#log').textContent=typeof v==='string'?v:JSON.stringify(v,null,2);}
function status(s){$('#status').textContent=s;}
async function getWav(name){const r=await fetch('../../test-audio/'+name);if(!r.ok)throw Error('No se pudo cargar '+name);return decodeWav(await r.arrayBuffer());}
try{const r=await fetch('./resultados.json');if(r.ok)$('#offline').textContent=JSON.stringify(await r.json(),null,2);else $('#offline').textContent='Ejecutar node experiments/medir-todo.mjs';}catch(e){$('#offline').textContent=e.message;}
let ctx,source,stream,worklet,analyser,raf,previousMessage,previousRaf,intervals=[],rafIntervals=[],messages=[],config={thresholds:[-24,-14,-7],hysteresis_db:1.5},runtimeCalibration=null,calChunks=[],calStarted=0,analysisRMS,analysisLUFS,analysisLevels,syllable,buffer,closed=false;
let lastPitch=0,pitchFns={YIN:yin,Autocorrelación:autocorrelation};
async function loadPitchLibs(){
  try{const {PitchDetector}=await import('../vendor/pitchy.min.js');const p=PitchDetector.forFloat32Array(2048);pitchFns.pitchy=(x,sr)=>{const [hz,c]=p.findPitch(x,sr);return c>.8?hz:null;};}catch{if(stage==='d')status('pitchy no instalado: comparador propio disponible.');}
  try{const m=await import('../vendor/meyda.min.js');const lib=m.default??m;lib.sampleRate=48000;lib.bufferSize=2048;pitchFns['Meyda centroid NO F0']=x=>lib.extract('spectralCentroid',x)*48000/2048;}catch{if(stage==='d')status('Meyda/pitchy pendientes de npm. No se simulan sus resultados.');}
}
if(stage==='d')loadPitchLibs();
async function stop(){closed=true;cancelAnimationFrame(raf);try{source?.stop?.();}catch{}stream?.getTracks().forEach(t=>t.stop());if(ctx&&ctx.state!=='closed')await ctx.close();ctx=null;source=null;stream=null;status('Entrada detenida.');}
async function start(kind,wav){
  await stop();closed=false;messages=[];intervals=[];rafIntervals=[];previousMessage=null;previousRaf=null;
  ctx=new AudioContext({sampleRate:48000,latencyHint:'interactive'});await ctx.resume();
  analysisRMS=new RMS(ctx.sampleRate);analysisLUFS=ctx.sampleRate===48000?new LUFS():null;analysisLevels=new Levels(config);syllable=new SyllableCounter(ctx.sampleRate);
  if(kind==='mic'){
    const on=$('#constraints').checked;
    stream=await navigator.mediaDevices.getUserMedia({audio:{channelCount:1,sampleRate:48000,echoCancellation:on,noiseSuppression:on,autoGainControl:on}});
    source=ctx.createMediaStreamSource(stream);log({solicitado:{echoCancellation:on,noiseSuppression:on,autoGainControl:on},real:stream.getAudioTracks()[0].getSettings()});
  }else{
    source=ctx.createBufferSource();const b=ctx.createBuffer(1,wav.samples.length,wav.sampleRate);b.copyToChannel(wav.samples,0);source.buffer=b;source.onended=()=>status('WAV terminado; métricas conservadas.');
  }
  analyser=ctx.createAnalyser();analyser.fftSize=2048;source.connect(analyser);buffer=new Float32Array(analyser.fftSize);
  const muted=ctx.createGain();muted.gain.value=0;analyser.connect(muted).connect(ctx.destination);
  try{
    await ctx.audioWorklet.addModule('../shared/captura-worklet.mjs');worklet=new AudioWorkletNode(ctx,'captura');worklet.port.postMessage({config});source.connect(worklet).connect(muted);
    worklet.port.onmessage=e=>{const now=performance.now();if(previousMessage!=null)intervals.push(now-previousMessage);previousMessage=now;messages.push(e.data);if(messages.length>1000)messages.shift();
      metric('Worklet RMS dBFS',fmt(e.data.rms));metric('LUFS 400 ms',fmt(e.data.lufs));metric('Nivel 1–4',e.data.level);metric('Picos /s',e.data.speed);metric('Bloque Worklet',e.data.bloque);metric('Worklet intervalo p95 ms',fmt(percentile(intervals,.95)));};
    metric('AudioWorklet','activo');
  }catch(e){metric('AudioWorklet',e.message);}
  if(kind==='wav'){if($('#listen').checked)source.connect(ctx.destination);source.start();}
  metric('sampleRate Hz',ctx.sampleRate);metric('baseLatency ms',fmt(ctx.baseLatency*1000));metric('outputLatency ms',fmt(ctx.outputLatency*1000));
  status(kind==='mic'?'Micrófono activo; monitor silenciado.':'WAV en reproducción para análisis.');
  function frame(){if(closed||!ctx)return;const now=performance.now();if(previousRaf!=null)rafIntervals.push(now-previousRaf);previousRaf=now;
    const cpu=performance.now();analyser.getFloatTimeDomainData(buffer);const instant=db(rms(buffer));metric('Analyser RMS ventana dBFS',fmt(instant));metric('Lectura Analyser CPU ms',fmt(performance.now()-cpu,4));metric('rAF intervalo p95 ms',fmt(percentile(rafIntervals,.95)));
    const canvas=$('#wave'),g=canvas.getContext('2d');g.clearRect(0,0,canvas.width,canvas.height);g.strokeStyle='#76dbb0';g.beginPath();for(let i=0;i<buffer.length;i++){const x=i/buffer.length*canvas.width,y=80-buffer[i]*75;i?g.lineTo(x,y):g.moveTo(x,y);}g.stroke();
    if(stage==='d'&&now-lastPitch>250){lastPitch=now;for(const [name,fn]of Object.entries(pitchFns)){const t=performance.now(),hz=fn(buffer,ctx.sampleRate);metric(name+' Hz',fmt(hz));metric(name+' CPU/hop ms',fmt(performance.now()-t,4));}}
    // La calibración por Analyser usa snapshots espaciados: no se presenta como PCM continuo.
    if(calStarted){calChunks.push({t:(now-calStarted)/1000,db:instant});metric('Calibración s',fmt((now-calStarted)/1000,1));if(now-calStarted>=10000){const n=percentile(calChunks.filter(v=>v.t<=5).map(v=>v.db),.65),h=percentile(calChunks.filter(v=>v.t>5).map(v=>v.db),.65),gap=Math.max(4,h-n);config={thresholds:[n-.75*gap,(n+h)/2,h+.55*gap],hysteresis_db:1.5};worklet?.port.postMessage({config});runtimeCalibration={normal_db:n,fuerte_db:h,...config};calStarted=0;log(runtimeCalibration);status('Calibración terminada.');}else status((now-calStarted)<5000?'Calibración: hable normal (5 s).':'Calibración: hable fuerte (5 s).');}
    raf=requestAnimationFrame(frame);
  }frame();
  return getMetrics();
}
function getMetrics(){return {sampleRate:ctx?.sampleRate,baseLatency_s:ctx?.baseLatency??null,outputLatency_s:ctx?.outputLatency??null,worklet_mensajes:messages.length,worklet_intervalo_media_ms:mean(intervals),worklet_intervalo_p95_ms:percentile(intervals,.95),raf_intervalo_p95_ms:percentile(rafIntervals,.95),worklet_ultimo:messages.at(-1)??null,constraints:stream?.getAudioTracks()[0]?.getSettings()??null};}
const safely=fn=>async()=>{try{await fn();}catch(e){status(e.message);log(e.stack);}};
$('#mic').onclick=safely(()=>start('mic'));$('#stop').onclick=stop;$('#load').onclick=safely(async()=>start('wav',await getWav($('#fixture').value)));$('#file').onchange=safely(async()=>{const f=$('#file').files[0];if(f)await start('wav',decodeWav(await f.arrayBuffer()));});
const panel=$('#specific');
if(stage==='a')panel.innerHTML='<h2>Comparación de captura</h2><p>Active y desactive constraints antes de reiniciar micrófono; los valores efectivos están en el registro. Las dos rutas reciben la misma señal: Worklet con bloques de 128 y Analyser con snapshots de 2048 por rAF. Los intervalos de entrega miden el hilo principal, no latencia acústica.</p>';
if(stage==='b'){
  panel.innerHTML='<h2>Calibrar 10 s</h2><p>5 s voz normal + 5 s voz fuerte. Requiere entrada activa. La calibración de archivo utiliza PCM continuo; la del micrófono utiliza snapshots del Analyser.</p><button id="cal">Calibrar entrada activa</button><button id="calfixture">Calibrar WAV de 10 s</button><button id="energy">Medir WAV completo</button><pre id="energyresult"></pre>';
  $('#cal').onclick=()=>{if(!ctx){status('Inicie primero una entrada.');return;}calStarted=performance.now();calChunks=[];};
  $('#calfixture').onclick=safely(async()=>{config=calibration((await getWav('calibracion.wav')).samples);worklet?.port.postMessage({config});log(config);status('Umbrales de calibracion.wav aplicados.');});
  $('#energy').onclick=safely(async()=>{const {samples:x}=await getWav($('#fixture').value),rows=[];for(const [method,processor]of [['RMS 20/300',new RMS()],['LUFS K 400 ms',new LUFS()]]){const begin=performance.now(),t=trace(x,processor,48000,config);rows.push({method,tiempo_total_ms:performance.now()-begin,cpu_media_ms_por128:(performance.now()-begin)/t.length,niveles:t.reduce((out,f)=>(out[f.level]=(out[f.level]??0)+1,out),{})});}$('#energyresult').textContent=JSON.stringify(rows,null,2);});
}
if(stage==='c')panel.innerHTML='<h2>Referencia lingüística</h2><p>Picos aproximan sílabas; compare con ground-truth.json. La ventana de tasa es de un segundo.</p><a href="./speech.html">Abrir prueba Web Speech API y wifi apagado →</a>';
if(stage==='d')panel.innerHTML='<h2>Benchmark en tablet</h2><p>YIN y autocorrelación: ventana 2048, actualización visual cada 250 ms. CPU mostrada por evaluación; ejecutar cada hop128 tendría presupuesto 2,667 ms. Pitchy se carga si vendor existe. Meyda muestra centroid espectral explícitamente: no es un estimador F0.</p>';
if(stage==='e'){
  panel.innerHTML='<h2>200 golpes</h2><p>Duración aproximada 4 s, bajo volumen. Jitter de programación; la latencia acústica requiere medición física.</p><button id="own">Planificador propio</button><button id="tone">Tone.js</button><pre id="jitterresult"></pre>';
  for(const [id,mode]of [['own','propio'],['tone','tone']])$('#'+id).onclick=safely(async()=>{status('Midiendo 200 golpes…');const result=await runJitter(mode);$('#jitterresult').textContent=JSON.stringify(result,null,2);status('Medición terminada.');});
}
function summarizeJitter(r){const errors=r.records.map(v=>Math.abs(v.error_ms)),callbacks=r.intervalos_callback_ms.slice(1);return {metodo:r.metodo,golpes:r.golpes,jitter_programado_p95_ms:percentile(errors,.95),jitter_programado_max_ms:Math.max(...errors),callback_jitter_p95_ms:percentile(callbacks.map(x=>Math.abs(x-25)),.95),margen_min_ms:Math.min(...r.records.map(v=>v.margen_ms)),duracion_real_ms:r.duracion_real_ms,nota:r.nota};}
async function runJitter(mode){return summarizeJitter(await jitterTest(mode));}
function download(blob,name){const url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),10000);}
async function render(key){const {buffer,render_ms,programacion_ms}=await renderLoop(key),x=buffer.getChannelData(0),wav=encodeWav(x),decoded=decodeWav(wav).samples;let err=0,peak=0,clipped=0;for(let i=0;i<x.length;i++){err+=(x[i]-decoded[i])**2;peak=Math.max(peak,Math.abs(x[i]));if(Math.abs(x[i])>1)clipped++;}return {buffer,wav,metrics:{tonalidad:key,duracion_s:buffer.duration,render_ms,programacion_ms,cpu_render_equivalente_ms_por128:render_ms/(x.length/128),peso_kib:wav.byteLength/1024,peso_12_mib:wav.byteLength*12/1024**2,error_pcm16_rms_dbfs:db(Math.sqrt(err/x.length)),pico_dbfs:db(peak),muestras_recortadas:clipped}};}
if(stage==='f'){
  panel.innerHTML='<h2>Progresión I-V-vi-IV</h2><select id="key"><option>Do</option><option>Sol</option></select><button id="synth">Síntesis</button><button id="loop">Loop WAV</button><button id="render">Renderizar y exportar WAV</button><pre id="soundresult"></pre>';
  $('#synth').onclick=safely(async()=>{const c=new AudioContext();await c.resume();const v=scheduleProgression(c,$('#key').value);setTimeout(()=>c.close(),9000);$('#soundresult').textContent=JSON.stringify(v,null,2);});
  $('#loop').onclick=safely(async()=>{const key=$('#key').value.toLowerCase(),r=await fetch(`loop-${key}.wav`);if(!r.ok)throw Error('Ejecute medir-navegador.mjs para guardar los loops, o renderice/exporte uno.');const c=new AudioContext();await c.resume();const b=await c.decodeAudioData(await r.arrayBuffer()),s=c.createBufferSource();s.buffer=b;s.connect(c.destination);s.onended=()=>c.close();s.start(c.currentTime+.1);});
  $('#render').onclick=safely(async()=>{const result=await render($('#key').value);$('#soundresult').textContent=JSON.stringify(result.metrics,null,2);download(new Blob([result.wav],{type:'audio/wav'}),`loop-${$('#key').value.toLowerCase()}.wav`);});
}
if(stage==='g'){
  panel.innerHTML='<h2>Gate y referencia digital</h2><p>Resta ideal sobre archivo alineado; un recinto real introduce retardo y reverberación. El gate elimina también parte de la voz.</p><select id="mitigation"><option value="none">Sin mitigación</option><option value="gate">Gate de nivel</option><option value="subtract">Restar música conocida</option></select><button id="retro">Medir WAV con mitigación</button><pre id="retroresult"></pre>';
  $('#retro').onclick=safely(async()=>{const name=$('#fixture').value,mode=$('#mitigation').value;let {samples:x}=await getWav(name),thresholds=config;if(mode==='gate')thresholds={thresholds:[-16,-12,-6],hysteresis_db:2};if(mode==='subtract'){if(!['musica-sola.wav','sermon-con-musica.wav'].includes(name))throw Error('La referencia corresponde a música sola o sermón con música.');const ref=(await getWav('musica-sola.wav')).samples,gt=await(await fetch('../../test-audio/ground-truth.json')).json();x=Float32Array.from(x,(v,i)=>v/(name==='musica-sola.wav'?1:gt.ganancia_mezcla)-ref[i]);}const t0=performance.now(),t=trace(x,new RMS(),48000,thresholds);$('#retroresult').textContent=JSON.stringify({modo:mode,nivel_ge2_pct:100*t.filter(f=>f.level>=2).length/t.length,cpu_media_ms_por128:(performance.now()-t0)/t.length},null,2);});
}
window.lab={startFixture:async(name='sermon-simulado.wav')=>start('wav',await getWav(name)),startMic:async(on)=>{$('#constraints').checked=on;return start('mic');},stop,getMetrics,runJitter,render:async(key)=>{const r=await render(key);return {metrics:r.metrics,wav:Array.from(new Uint8Array(r.wav))};}};
