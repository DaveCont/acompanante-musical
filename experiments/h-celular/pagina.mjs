// Prueba en celular: micrófono y bocina del mismo teléfono.
// Reutiliza el método ganador de energía (b-energia, "hybrid") y la música sintetizada (shared/sound.mjs).
import {winnerId,calibrate} from '../b-energia/energia.mjs';
import {decodeWav} from '../shared/wav.mjs';
import {scheduleProgression,LOOP_SECONDS} from '../shared/sound.mjs';

const $=s=>document.querySelector(s);
let ctx,stream,source,worklet,musicGain,loopTimer=null,nextLoop=0,config,last=null,leakTest=null;
const VOL_POR_NIVEL=[0,.3,.5,.75,1]; // volumen relativo de la música para niveles 1–4
const status=s=>{$('#status').textContent=s;};
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
    if(data.calibration){try{config=calibrate(data.calibration,winnerId,ctx.sampleRate);worklet.port.postMessage({method:winnerId,config});{const dif=config.fuerte_db-config.normal_db,eco=$('#aec').checked?'eco ON':'eco OFF';diag.calibraciones=(diag.calibraciones||[]).concat({eco,normal_db:+config.normal_db.toFixed(1),fuerte_db:+config.fuerte_db.toFixed(1),diferencia_db:+dif.toFixed(1)});status(`✔ Calibrado (${eco}). Diferencia normal→fuerte: ${dif.toFixed(1)} dB `+(dif>=8?'✔ buena':'✖ muy poca (ideal 8 dB o más)'));}log({calibracion:config});}catch(e){fallo('calibración',e);}return;}
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
  musicGain.gain.setTargetAtTime(objetivo,ctx.currentTime,.5/3);
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
  if(loopTimer!==null){clearInterval(loopTimer);loopTimer=null;}
  if(musicGain&&ctx){musicGain.gain.cancelScheduledValues(ctx.currentTime);musicGain.gain.setTargetAtTime(0,ctx.currentTime,.15);}
}

function mostrar(d){
  const anterior=last?.level;last=d;
  const n=$('#nivel');n.className='n'+d.level;n.firstChild.textContent=d.level;
  if(d.level!==anterior)volumenMusica();
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
$('#calibrar').onclick=()=>{if(!worklet){status('Primero inicia el micrófono.');return;}pararMusica();worklet.port.postMessage({calibrate:true});};
$('#musica').onclick=safely(async()=>tocarMusica());
$('#parar').onclick=()=>pararMusica();
$('#volumen').oninput=()=>volumenMusica();
$('#reacciona').onchange=()=>volumenMusica();
$('#fuga').onclick=()=>{if(!worklet){status('Primero inicia el micrófono.');return;}if(loopTimer===null)tocarMusica();$('#veredicto').className='';leakTest={inicio:performance.now(),muestras:[]};};

// Versión visible, para confirmar que el teléfono no muestra una copia vieja.
const VERSION='v4 (2026-11-08)';
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
