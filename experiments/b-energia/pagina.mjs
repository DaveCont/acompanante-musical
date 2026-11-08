import {methods,winnerId,calibrate,energyTrace} from './energia.mjs';
import {decodeWav} from '../shared/wav.mjs';

const $=s=>document.querySelector(s),configs=new Map();
let ctx,source,stream,worklet,last=null,generation=0,calibrationPCM;
const status=s=>{$('#status').textContent=s;};
const log=x=>{$('#log').textContent=JSON.stringify(x,null,2);};
const safely=fn=>async()=>{try{return await fn();}catch(e){status(e.message);log({error:e.stack});}};
const method=()=>$('#method').value;
async function getWav(name){const r=await fetch('../../test-audio/'+name);if(!r.ok)throw Error('No se pudo cargar '+name);return decodeWav(await r.arrayBuffer());}
function calibration(id,sr=48000){
  const key=id+':'+sr;
  if(!configs.has(key)){
    if(sr!==48000)throw Error('Esta comparación requiere entrada a 48 kHz.');
    configs.set(key,calibrate(calibrationPCM,id,sr));
  }
  return configs.get(key);
}
function applyMethod(){
  const id=method(),config=calibration(id),m=methods.find(m=>m.id===id);
  worklet?.port.postMessage({method:id,config});
  $('#parameters').textContent=id===winnerId?'Recomendado: HP 100 Hz · RMS 30/80 ms · p85 de voz en 1,5 s · hold 1,5 s · histéresis 1,5 dB.':'Método: '+m.nombre+' · histéresis 1,5 dB.';
  log(config);
}
function show(data){
  last=data;
  const values={'Nivel 1–4':data.level,'Energía estable dB':data.db.toFixed(2),'Energía rápida dB':data.fast_db.toFixed(2),'Voz':data.voice?'sí':'no','Silencio s':data.silencio_s.toFixed(2),'Bloque':data.bloque};
  $('#metrics').replaceChildren(...Object.entries(values).map(([label,value])=>{const d=document.createElement('div');d.className='metric';d.textContent=label;const b=document.createElement('strong');b.textContent=value;d.append(b);return d;}));
  const canvas=$('#wave'),g=canvas.getContext('2d');g.clearRect(0,0,canvas.width,canvas.height);
  const width=db=>Math.max(0,Math.min(canvas.width,(db+70)/70*canvas.width));
  g.fillStyle='#76dbb0';g.fillRect(0,20,width(data.db),45);g.fillStyle='#eac76f';g.fillRect(0,90,width(data.fast_db),30);
  g.strokeStyle='#ffffff';for(const t of calibration(method()).thresholds){g.beginPath();g.moveTo(width(t),0);g.lineTo(width(t),160);g.stroke();}
  if(data.calibracion_s!==null)status(data.calibracion_s<5?`Calibración: voz normal (${data.calibracion_s.toFixed(1)}/5 s).`:`Calibración: voz fuerte (${(data.calibracion_s-5).toFixed(1)}/5 s).`);
}
async function stop(){
  const token=++generation;try{source?.stop?.();}catch{}
  source?.disconnect();stream?.getTracks().forEach(t=>t.stop());
  if(worklet)worklet.port.onmessage=null;
  const old=ctx;ctx=source=stream=worklet=null;
  if(old&&old.state!=='closed')await old.close();if(token===generation)status('Entrada detenida.');return token;
}
async function start(kind,wav){
  const token=await stop();if(token!==generation)return;
  last=null;
  try{
    ctx=new AudioContext({sampleRate:48000,latencyHint:'interactive'});await ctx.resume();
    if(token!==generation)return;
    if(ctx.sampleRate!==48000)throw Error('Se requieren 48 kHz para comparar también LUFS.');
    if(kind==='mic'){
      const on=$('#constraints').checked;
      const acquired=await navigator.mediaDevices.getUserMedia({audio:{channelCount:1,sampleRate:48000,echoCancellation:on,noiseSuppression:on,autoGainControl:on}});
      if(token!==generation){acquired.getTracks().forEach(t=>t.stop());return;}
      stream=acquired;source=ctx.createMediaStreamSource(stream);log(stream.getAudioTracks()[0].getSettings());
    }else{
      source=ctx.createBufferSource();const b=ctx.createBuffer(1,wav.samples.length,wav.sampleRate);b.copyToChannel(wav.samples,0);source.buffer=b;
      source.onended=()=>{if(token===generation)status('WAV terminado; métricas conservadas.');};
    }
    await ctx.audioWorklet.addModule('./energia-worklet.mjs');
    if(token!==generation)return;
    worklet=new AudioWorkletNode(ctx,'energia');
    worklet.port.onmessage=({data})=>{
      if(data.calibration){calibrationPCM=data.calibration;configs.clear();applyMethod();status('Calibración continua de 10 s aplicada.');}
      else show(data);
    };
    applyMethod();const mute=ctx.createGain();mute.gain.value=0;
    source.connect(worklet).connect(mute).connect(ctx.destination);
    if(kind==='wav'){if($('#listen').checked)source.connect(ctx.destination);source.start();}
    status(kind==='mic'?'Micrófono activo.':'WAV en reproducción para análisis.');return getMetrics();
  }catch(e){if(token===generation)await stop();throw e;}
}
function getMetrics(){return {sampleRate:ctx?.sampleRate,metodo:method(),worklet_ultimo:last,calibracion:calibration(method())};}

$('#method').innerHTML=methods.map(m=>`<option value="${m.id}">${m.nombre}${m.id===winnerId?' (recomendado)':''}</option>`).join('');$('#method').value=winnerId;
$('#fixture').innerHTML=['sermon-simulado.wav','sermon-con-musica.wav','voz-normal.wav','voz-rapida.wav','voz-lenta.wav','musica-sola.wav','calibracion.wav','tonos.wav'].map(f=>`<option>${f}</option>`).join('');
const ready=getWav('calibracion.wav').then(w=>{calibrationPCM=w.samples;applyMethod();});
ready.catch(e=>status(e.message));
$('#method').onchange=safely(async()=>{await ready;applyMethod();});
$('#mic').onclick=safely(async()=>{await ready;await start('mic');});
$('#stop').onclick=safely(stop);
$('#load').onclick=safely(async()=>{await ready;await start('wav',await getWav($('#fixture').value));});
$('#file').onchange=safely(async()=>{await ready;const f=$('#file').files[0];if(f)await start('wav',decodeWav(await f.arrayBuffer()));});
$('#cal').onclick=()=>{if(!worklet){status('Inicie primero una entrada.');return;}worklet.port.postMessage({calibrate:true});status('Calibración: voz normal durante 5 s y luego fuerte durante 5 s.');};
$('#calfixture').onclick=safely(async()=>{await ready;calibrationPCM=(await getWav('calibracion.wav')).samples;configs.clear();applyMethod();status('Calibración de WAV aplicada.');});
$('#energy').onclick=safely(async()=>{
  await ready;const w=await getWav($('#fixture').value),id=method(),begin=performance.now();
  if(w.sampleRate!==48000)throw Error('Se requieren 48 kHz.');
  const t=energyTrace(w.samples,id,calibration(id)),elapsed=performance.now()-begin;
  $('#energyresult').textContent=JSON.stringify({metodo:id,tiempo_total_ms:elapsed,cpu_traza_ms_por128:elapsed/t.length,niveles:t.reduce((out,f)=>(out[f.level]=(out[f.level]??0)+1,out),{})},null,2);
});
fetch('./resultados.json').then(r=>{if(!r.ok)throw Error('Ejecute node experiments/b-energia/medir.mjs');return r.json();}).then(r=>{$('#offline').textContent=JSON.stringify(r,null,2);}).catch(e=>{$('#offline').textContent=e.message;});
window.lab={ready,startFixture:async(name='sermon-simulado.wav')=>{await ready;return start('wav',await getWav(name));},startMic:async(on=false)=>{await ready;$('#constraints').checked=on;return start('mic');},stop,getMetrics};
