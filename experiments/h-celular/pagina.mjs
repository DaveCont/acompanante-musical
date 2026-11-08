// Prueba en celular: micrófono y bocina del mismo teléfono.
// Reutiliza el método ganador de energía (b-energia, "hybrid") y la música sintetizada (shared/sound.mjs).
import {winnerId,calibrate} from '../b-energia/energia.mjs';
import {decodeWav} from '../shared/wav.mjs';
import {scheduleProgression,LOOP_SECONDS} from '../shared/sound.mjs';

const $=s=>document.querySelector(s);
let calEspera=null,brillo=null,historia=[],libre=null,musicaObjetivo=0,ctx,stream,source,worklet,musicGain,loopTimer=null,nextLoop=0,config,last=null,leakTest=null;
const VOL_POR_NIVEL=[0,.3,.5,.75,1]; // volumen relativo de la música para niveles 1–4
const status=s=>{$('#status').textContent=s;const f=$('#fijomsg');if(f)f.textContent=s;};
const log=x=>{$('#log').textContent=JSON.stringify(x,null,2);};
const safely=fn=>async()=>{try{await fn();}catch(e){status('Error: '+e.message);log({error:String(e.stack||e)});fallo(diag?.paso??'acción',e);}};

// Calibración por defecto (voz sintética) hasta que el usuario calibre la suya.
const defaultCal=fetch('../../test-audio/calibracion.wav').then(r=>r.arrayBuffer()).then(b=>{config=calibrate(decodeWav(b).samples,winnerId);});

// ---- Diagnóstico visible: para saber en el teléfono qué parte funciona y cuál no ----
const diag={navegador:navigator.userAgent,paso:'sin iniciar',contexto:'-',frecuencia_hz:'-',mensajes_procesador:0,microfono_db:'-',errores:[]};
let analyser=null,meterBuf=null;
function fallo(donde,e){diag.errores.push(donde+': '+(e?.message||e));pintarDiag();}
window.addEventListener('error',e=>fallo('página',e.message));
window.addEventListener('unhandledrejection',e=>fallo('promesa',e.reason));
function pintarDiag(){
  const ok=v=>v?'✔':'✖';
  const rows=[
    ['1. Audio encendido',ok(diag.contexto==='running')+' '+diag.contexto],
    ['2. Micrófono llega',ok(diag.microfono_db!=='-'&&diag.microfono_db>-90)+' '+diag.microfono_db+' dB'],
    ['3. Analizador de voz',ok(diag.mensajes_procesador>0)+' '+diag.mensajes_procesador+' datos'],
    ['Frecuencia',diag.frecuencia_hz+' Hz'],['Paso',diag.paso]];
  $('#diag').replaceChildren(...rows.map(([k,v])=>{const e=document.createElement('div');e.className='metric';e.textContent=k;const b=document.createElement('strong');b.textContent=v;e.append(b);return e;}));
  $('#errores').textContent=diag.errores.join('\n');
}
// Medidor directo del micrófono (AnalyserNode), independiente del analizador de voz.
function medidor(){
  if(!analyser)return;
  analyser.getFloatTimeDomainData(meterBuf);
  let s=0;for(const v of meterBuf)s+=v*v;
  const db=10*Math.log10(s/meterBuf.length+1e-12);
  diag.microfono_db=Math.round(db);diag.contexto=ctx?.state??'-';
  $('#crudo').style.width=Math.max(0,Math.min(100,(db+80)/80*100))+'%';
  pintarDiag();requestAnimationFrame(medidor);
}

async function iniciar(){
  await detener();
  // IMPORTANTE (iPhone): crear y encender el audio en el mismo instante del toque, antes de cualquier espera.
  try{if(navigator.audioSession)navigator.audioSession.type='play-and-record';}catch{}
  // Sin forzar 48 kHz: se usa la frecuencia nativa del teléfono (en iPhone forzarla puede dar silencio).
  ctx=new AudioContext({latencyHint:'interactive'});const encender=ctx.resume();
  diag.paso='pidiendo micrófono';diag.errores=[];pintarDiag();
  const opciones={channelCount:1,echoCancellation:$('#aec').checked,noiseSuppression:$('#ns').checked,autoGainControl:$('#agc').checked};
  stream=await navigator.mediaDevices.getUserMedia({audio:opciones});
  await encender;await defaultCal;
  diag.frecuencia_hz=ctx.sampleRate;diag.contexto=ctx.state;
  source=ctx.createMediaStreamSource(stream);
  analyser=ctx.createAnalyser();analyser.fftSize=2048;meterBuf=new Float32Array(analyser.fftSize);source.connect(analyser);
  requestAnimationFrame(medidor);
  diag.paso='cargando analizador';pintarDiag();
  await ctx.audioWorklet.addModule('../b-energia/energia-worklet.mjs');
  worklet=new AudioWorkletNode(ctx,'energia');
  worklet.onprocessorerror=e=>fallo('analizador',e.message||'error interno del procesador');
  worklet.port.onmessage=({data})=>{
    diag.mensajes_procesador++;
    if(data.calibration){try{config=calibrate(data.calibration,winnerId,ctx.sampleRate);worklet.port.postMessage({method:winnerId,config});{const dif=config.fuerte_db-config.normal_db,eco=$('#aec').checked?'eco ON':'eco OFF';diag.calibraciones=(diag.calibraciones||[]).concat({eco,normal_db:+config.normal_db.toFixed(1),fuerte_db:+config.fuerte_db.toFixed(1),diferencia_db:+dif.toFixed(1)});status(`✔ Calibrado (${eco}). Diferencia normal→fuerte: ${dif.toFixed(1)} dB `+(dif>=8?'✔ buena':'✖ muy poca (ideal 8 dB o más)'));}if(calEspera){calEspera(diag.calibraciones.at(-1));calEspera=null;}log({calibracion:config});}catch(e){fallo('calibración',e);}return;}
    mostrar(data);
  };
  worklet.port.postMessage({method:winnerId,config});
  const mute=ctx.createGain();mute.gain.value=0;source.connect(worklet).connect(mute).connect(ctx.destination);
  musicGain=ctx.createGain();musicGain.gain.value=0;musicGain.connect(ctx.destination);
  const s=stream.getAudioTracks()[0].getSettings();
  diag.paso='listo';diag.ajustes=s;pintarDiag();
  log({ajustes_reales_microfono:s,frecuencia:ctx.sampleRate,baseLatency_ms:ctx.baseLatency*1000,outputLatency_ms:(ctx.outputLatency||0)*1000});
  status(`Micrófono activo · eco ${s.echoCancellation?'ON':'OFF'} · ruido ${s.noiseSuppression?'ON':'OFF'} · AGC ${s.autoGainControl?'ON':'OFF'}`);
  // Si a los 2 s el analizador no ha mandado nada, avisarlo claramente.
  setTimeout(()=>{if(ctx&&diag.mensajes_procesador===0)fallo('analizador','no envía datos (audio: '+ctx.state+'). Toca "Detener" y otra vez "Iniciar".');},2000);
}

async function detener(){
  pararMusica();
  try{source?.disconnect();}catch{}
  stream?.getTracks().forEach(t=>t.stop());
  if(ctx&&ctx.state!=='closed')await ctx.close();
  ctx=stream=source=worklet=musicGain=analyser=null;leakTest=null;status('Detenido.');
}

function volumenMusica(){
  if(!musicGain||loopTimer===null)return;
  const base=+$('#volumen').value,nivel=last?.level??2;
  const objetivo=$('#reacciona').checked?base*VOL_POR_NIVEL[nivel]:base;
  // Rampa suave de 0,5 s: nunca cortes bruscos.
  musicaObjetivo=objetivo;musicGain.gain.setTargetAtTime(objetivo,ctx.currentTime,.5/3);
}

function tocarMusica(){
  if(!ctx){status('Primero inicia el micrófono.');return;}
  if(loopTimer!==null)return;
  nextLoop=ctx.currentTime+.1;
  // Planificador simple: agenda la siguiente vuelta de 8 s con 1 s de anticipación.
  const tick=()=>{while(nextLoop<ctx.currentTime+1){scheduleProgression(ctx,$('#tono').value,nextLoop,musicGain);nextLoop+=LOOP_SECONDS;}};
  tick();loopTimer=setInterval(tick,250);volumenMusica();
}
function pararMusica(){
  musicaObjetivo=0;
  if(loopTimer!==null){clearInterval(loopTimer);loopTimer=null;}
  if(musicGain&&ctx){musicGain.gain.cancelScheduledValues(ctx.currentTime);musicGain.gain.setTargetAtTime(0,ctx.currentTime,.15);}
}

function mostrar(d){
  const anterior=last?.level;last=d;
  const n=$('#nivel');n.className='n'+d.level;n.firstChild.textContent=d.level;
  if(d.level!==anterior)volumenMusica();
  // Barra fija de arriba e historial de 30 s.
  $('#minivoz').style.width=Math.max(0,Math.min(100,(d.fast_db+70)/70*100))+'%';
  $('#minimusica').style.width=Math.min(100,musicaObjetivo*100)+'%';
  $('#fijoestado').textContent=(d.voice?'🗣 hablando':'… silencio')+(loopTimer!==null?' · ♪ música':' · sin música');
  const ahora=performance.now()/1000;historia.push({t:ahora,level:d.level,voice:d.voice,musica:musicaObjetivo});
  while(historia.length&&historia[0].t<ahora-30)historia.shift();
  if(diag.mensajes_procesador%3===0)dibujarHistoria(ahora);
  if(libre){libre.muestras.push({level:d.level,voice:d.voice});const r=30-(ahora-libre.inicio);
    if(r>0)$('#libre').textContent=`Predicando… ${r.toFixed(0)} s`;else terminarLibre();}
  const vals={'Energía dB':d.db.toFixed(1),'Rápida dB':d.fast_db.toFixed(1),'¿Voz?':d.voice?'sí':'no','Silencio s':d.silencio_s.toFixed(1)};
  $('#metrics').replaceChildren(...Object.entries(vals).map(([k,v])=>{const e=document.createElement('div');e.className='metric';e.textContent=k;const b=document.createElement('strong');b.textContent=v;e.append(b);return e;}));
  const c=$('#barra'),g=c.getContext('2d'),x=db=>Math.max(0,Math.min(c.width,(db+70)/70*c.width));
  g.clearRect(0,0,c.width,c.height);g.fillStyle='#76dbb0';g.fillRect(0,15,x(d.db),45);g.fillStyle='#eac76f';g.fillRect(0,75,x(d.fast_db),30);
  g.strokeStyle='#fff';g.lineWidth=3;for(const t of config.thresholds){g.beginPath();g.moveTo(x(t),0);g.lineTo(x(t),c.height);g.stroke();}
  if(d.calibracion_s!==null)status(d.calibracion_s<5?`Habla NORMAL… ${(5-d.calibracion_s).toFixed(1)} s`:`¡Ahora FUERTE! ${(10-d.calibracion_s).toFixed(1)} s`);
  if(leakTest){
    leakTest.muestras.push(d);
    const t=(performance.now()-leakTest.inicio)/1000;
    if(t<10)$('#veredicto').textContent=`Silencio… ${(10-t).toFixed(1)} s`;else terminarFuga();
  }
}

function dibujarHistoria(ahora){
  const c=$('#historia'),g=c.getContext('2d'),W=c.width,H=c.height,col=['#000','#2d4a66','#1f8a6a','#c9a227','#d04a4a'];
  g.clearRect(0,0,W,H);g.fillStyle='#08101b';g.fillRect(0,0,W,H);
  g.fillStyle='#ffffff55';g.font='22px system-ui';for(let n=1;n<=4;n++)g.fillText(n,4,H-(n/4)*H*.85+18);
  for(const h of historia){const x=W-(ahora-h.t)/30*W,alto=h.level/4*H*.85;g.fillStyle=col[h.level];g.fillRect(x,H-alto,4,alto);}
  g.strokeStyle='#b48cf0';g.lineWidth=4;g.beginPath();
  historia.forEach((h,i)=>{const x=W-(ahora-h.t)/30*W,y=H-h.musica*H*.85;i?g.lineTo(x,y):g.moveTo(x,y);});g.stroke();
}
function terminarLibre(){
  const m=libre.muestras;libre=null;$('#libre').textContent='▶ Repetir prueba libre (30 s)';
  const pct=f=>100*m.filter(f).length/m.length,cambios=m.filter((d,i)=>i&&d.level!==m[i-1].level).length;
  const r={nivel1:pct(d=>d.level===1),nivel2:pct(d=>d.level===2),nivel3:pct(d=>d.level===3),nivel4:pct(d=>d.level===4),cambios_de_nivel:cambios,alto_sin_voz:pct(d=>d.level>=3&&!d.voice)};
  diag.prueba_libre=(diag.prueba_libre||[]).concat({...Object.fromEntries(Object.entries(r).map(([k,v])=>[k,Math.round(v)])),eco:$('#aec').checked});
  $('#librever').textContent=`Tiempo en cada nivel: 1 → ${r.nivel1.toFixed(0)} %, 2 → ${r.nivel2.toFixed(0)} %, 3 → ${r.nivel3.toFixed(0)} %, 4 → ${r.nivel4.toFixed(0)} %
Cambios de nivel: ${cambios} (pocos = estable; muchos = parpadea)
Nivel alto (3–4) sin que hablaras: ${r.alto_sin_voz.toFixed(0)} % (debería ser casi 0)
¿El nivel subió cuando tú subiste? Dímelo en el chat.`;
}
function terminarFuga(){
  const m=leakTest.muestras;leakTest=null;
  const pct=(f)=>100*m.filter(f).length/m.length;
  const nivel2=pct(d=>d.level>=2),voz=pct(d=>d.voice),max=Math.max(...m.map(d=>d.level));
  const fugaDb=m.map(d=>d.fast_db).sort((a,b)=>a-b)[Math.floor(m.length*.9)];
  const margen=config.normal_db-fugaDb; // cuántos dB está tu voz normal por encima de la música captada
  const ok=nivel2<10&&max<=2;
  const v=$('#veredicto');v.className=ok?'ok':'mal';
  v.textContent=(ok?'✔ La música casi no confunde a la app.':'✖ La app se escucha a sí misma: la música sola dispara niveles.')+
    `\nTiempo en nivel ≥2 sin hablar: ${nivel2.toFixed(0)} %\nNivel máximo alcanzado: ${max}\nTiempo marcado como "voz": ${voz.toFixed(0)} %`+
    `\nTu voz normal está ${margen.toFixed(1)} dB por encima de la música captada (ideal: más de 15 dB).`+
    (ok?'':'\nPrueba: activar cancelación de eco, bajar la música, acercar el micrófono a tu boca, o usar audífonos.');
  log({prueba_fuga:{nivel_ge2_pct:nivel2,max_nivel:max,voz_pct:voz,musica_captada_p90_db:fugaDb,voz_normal_db:config.normal_db,margen_db:margen,eco:$('#aec').checked,volumen:+$('#volumen').value}});
}

$('#iniciar').onclick=safely(iniciar);
$('#detener').onclick=safely(detener);
// ---- Brillo de la voz: agudos (1,5–5 kHz) frente a graves (150–1000 Hz). Sube con el esfuerzo vocal
// aunque el teléfono comprima el volumen. Se mide solo mientras hay voz.
function iniciarBrillo(){
  const fb=new Float32Array(analyser.frequencyBinCount),hz=ctx.sampleRate/analyser.fftSize,inicio=performance.now();
  const suma=(a,b)=>{let t=0;for(let i=Math.round(a/hz);i<=Math.round(b/hz);i++)t+=10**(fb[i]/10);return t;};
  brillo={normal:[],fuerte:[]};
  brillo.timer=setInterval(()=>{
    const t=(performance.now()-inicio)/1000;if(!analyser||!last?.voice)return;
    analyser.getFloatFrequencyData(fb);const v=10*Math.log10(suma(1500,5000)/(suma(150,1000)+1e-20));
    if(t>1&&t<5)brillo.normal.push(v);else if(t>6&&t<10)brillo.fuerte.push(v);
  },100);
}
function terminarBrillo(){
  clearInterval(brillo.timer);const med=a=>a.length?a.sort((x,y)=>x-y)[a.length>>1]:NaN;
  const r={brillo_normal_db:+med(brillo.normal).toFixed(1),brillo_fuerte_db:+med(brillo.fuerte).toFixed(1)};r.brillo_diferencia_db=+(r.brillo_fuerte_db-r.brillo_normal_db).toFixed(1);brillo=null;return r;
}
async function calibrarConBrillo(){
  pararMusica();const fin=new Promise(r=>calEspera=r);iniciarBrillo();worklet.port.postMessage({calibrate:true});
  const cal=await fin;return {...cal,...terminarBrillo()};
}
const espera=ms=>new Promise(r=>setTimeout(r,ms));
// ---- Prueba guiada: calibra con eco ON y luego con eco OFF, sin tocar casillas.
async function guiada(){
  const out=$('#guiadares');out.textContent='';const resultados=[];
  for(const eco of [true,false]){
    $('#aec').checked=eco;$('#ns').checked=false;$('#agc').checked=false;
    await iniciar();
    for(let i=3;i>0;i--){status(`Prueba ${eco?'1/2 (eco ON)':'2/2 (eco OFF)'}: prepárate… ${i}`);await espera(1000);}
    resultados.push(await calibrarConBrillo());
    out.textContent=resultados.map(r=>`${r.eco}: volumen normal→fuerte ${r.diferencia_db} dB · brillo ${r.brillo_diferencia_db} dB`).join(String.fromCharCode(10));
  }
  diag.guiada=resultados;
  const [on,off]=resultados,mejor=off.diferencia_db>on.diferencia_db+3?'eco OFF':'eco ON';
  out.textContent+=`

Volumen: ${off.diferencia_db>=8||on.diferencia_db>=8?'✔ al menos un modo distingue normal de fuerte':'✖ ningún modo distingue bien por volumen'} (mejor: ${mejor}).`+
    `
Brillo: ${Math.max(on.brillo_diferencia_db,off.brillo_diferencia_db)>=3?'✔ el brillo sí cambia al subir la voz (sirve de respaldo)':'✖ el brillo cambia poco'}.`+
    `
Ahora toca 📤 Compartir y mándame el diagnóstico.`;
  status('✔ Prueba guiada terminada. Quedó calibrado con eco OFF.');
}
$('#guiada').onclick=safely(guiada);
$('#calibrar').onclick=()=>{if(!worklet){status('Primero inicia el micrófono.');return;}pararMusica();worklet.port.postMessage({calibrate:true});};
$('#musica').onclick=safely(async()=>tocarMusica());
$('#parar').onclick=()=>pararMusica();
$('#volumen').oninput=()=>volumenMusica();
$('#reacciona').onchange=()=>volumenMusica();
$('#libre').onclick=()=>{if(!worklet){status('Primero inicia el micrófono (sección 1).');$('#librever').textContent='Primero toca ▶ Iniciar micrófono en la sección 1.';return;}if(loopTimer===null)tocarMusica();$('#librever').textContent='';libre={inicio:performance.now()/1000,muestras:[]};};
$('#fuga').onclick=()=>{if(!worklet){status('Primero inicia el micrófono.');return;}if(loopTimer===null)tocarMusica();$('#veredicto').className='';leakTest={inicio:performance.now(),muestras:[]};};

// Versión visible, para confirmar que el teléfono no muestra una copia vieja.
const VERSION='v6 (2026-11-08)';
// Revisión del navegador al cargar.
const ua=navigator.userAgent;
diag.compatibilidad={
  version:VERSION,
  conexion_segura:window.isSecureContext,
  audio:!!(window.AudioContext||window.webkitAudioContext),
  microfono:!!navigator.mediaDevices?.getUserMedia,
  audioworklet:typeof AudioWorkletNode!=='undefined',
  navegador_interno:/FBAN|FBAV|FB_IAB|Instagram|WhatsApp|Line\/|Messenger|GSA\//i.test(ua)
};
{
  const c=diag.compatibilidad,ok=v=>v?'✔':'✖',avisos=[];
  if(c.navegador_interno)avisos.push('⚠ Estás en el navegador interno de una app (WhatsApp/Facebook/etc.). Ábrela en Safari o Chrome: menú ⋯ → "Abrir en el navegador".');
  if(!c.conexion_segura)avisos.push('⚠ La página no es segura (https): el micrófono no funcionará.');
  if(!c.audio||!c.audioworklet)avisos.push('⚠ Este navegador no tiene el audio necesario. Actualiza Safari/Chrome.');
  if(!c.microfono)avisos.push('⚠ Este navegador no permite usar el micrófono aquí.');
  $('#compat').textContent=`Página ${VERSION} cargada ✔ · audio ${ok(c.audio&&c.audioworklet)} · micrófono ${ok(c.microfono)} · https ${ok(c.conexion_segura)}`+(avisos.length?'\n'+avisos.join('\n'):'');
  $('#compat').className=avisos.length?'mal':'ok';
}

// Diagnóstico: siempre visible en un cuadro de texto (no depende del portapapeles).
function textoDiag(){
  const {ajustes,...resto}=diag;
  return JSON.stringify({...resto,microfono_ajustes:ajustes,ultimo_dato:last,umbrales:config?.thresholds},null,1);
}
$('#copiar').onclick=async()=>{
  const caja=$('#diagtexto');caja.hidden=false;caja.value=textoDiag();caja.focus();caja.select();caja.setSelectionRange(0,caja.value.length);
  let copiado=false;
  try{await navigator.clipboard.writeText(caja.value);copiado=true;}catch{}
  if(!copiado){try{copiado=document.execCommand('copy');}catch{}}
  $('#copiar').textContent=copiado?'✔ Copiado. Pégalo en el chat (o mándalo con el botón Compartir)':'Mantén presionado el texto de abajo → Seleccionar todo → Copiar';
};
$('#compartir').onclick=async()=>{
  const texto=textoDiag();
  if(navigator.share){try{await navigator.share({title:'Diagnóstico acompañante',text:texto});}catch{}}
  else{$('#diagtexto').hidden=false;$('#diagtexto').value=texto;$('#compartir').textContent='Este navegador no puede compartir: copia el texto de abajo';}
};
pintarDiag();
