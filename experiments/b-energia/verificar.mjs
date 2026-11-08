import assert from 'node:assert/strict';
import {audio} from '../shared/node.mjs';
import fs from 'node:fs';
import {RMS,LUFS,trace,percentile} from '../shared/dsp.mjs';
import {Energy,methods,calibrate,energyTrace,winnerId} from './energia.mjs';
const sr=48000,cal=audio('calibracion.wav').samples;
// Los cuatro métodos anteriores deben conservar exactamente toda su traza.
const x=audio('sermon-simulado.wav').samples;
for(const m of methods.filter(m=>m.legacy)){
  const make=()=>m.id==='lufs'?new LUFS():new RMS(sr,m.attack,m.release);
  const ct=trace(cal,make()),n=percentile(ct.filter(f=>f.t>=1&&f.t<=5).map(f=>f.db),.65),h=percentile(ct.filter(f=>f.t>=6).map(f=>f.db),.65),g=Math.max(4,h-n);
  const config={thresholds:[n-.75*g,(n+h)/2,h+.55*g],hysteresis_db:1.5};
  const old=trace(x,make(),sr,config),current=energyTrace(x,m.id,calibrate(cal,m.id));
  assert.equal(old.length,current.length);
  for(let i=0;i<old.length;i++){assert.equal(current[i].db,old[i].db);assert.equal(current[i].level,old[i].level);}
}
const config=calibrate(cal,winnerId),p=new Energy(winnerId,sr,config),block=new Float32Array(128),zero=new Float32Array(128);
let sample=0;
function tone(seconds,amplitude=.8){for(let k=0;k<seconds*sr/128;k++){for(let i=0;i<128;i++)block[i]=amplitude*Math.sin(2*Math.PI*1000*sample++/sr);p.process(block);}}
function silence(seconds){for(let k=0;k<seconds*sr/128;k++)p.process(zero);}
tone(2);assert.equal(p.level,3);silence(1);assert.equal(p.level,3,'Conservar nivel durante pausa corta');
silence(1.5);assert.equal(p.level,1,'Bajar tras silencio sostenido');
// Subida real sin silencio previo: la ventana no debe obligar a esperar 1,5 s.
tone(2,.2);assert.equal(p.level,2);let hit=null;
for(let i=0;i<200;i++){tone(128/sr,.8);if(p.level===3){hit=(i+1)*128/sr;break;}}
assert.ok(hit!==null&&hit<.4,'La subida continua debe tardar menos de 400 ms');
assert.throws(()=>calibrate(cal.subarray(0,cal.length-128),winnerId),/10 s/);
// Contrato real del worklet con host simulado de bloques 128. No sustituye navegador.
let Worklet;
globalThis.sampleRate=sr;
globalThis.AudioWorkletProcessor=class{constructor(){this.sent=[];this.port={postMessage:data=>this.sent.push(data)};}};
globalThis.registerProcessor=(name,cls)=>{assert.equal(name,'energia');Worklet=cls;};
await import('./energia-worklet.mjs');
const parity=[];
for(const name of ['sermon-simulado.wav','sermon-con-musica.wav']){
  const samples=audio(name).samples,w=new Worklet();
  w.port.onmessage({data:{method:winnerId,config}});
  const expected=energyTrace(samples,winnerId,config);
  for(let i=0;i<samples.length;i+=128)w.process([[samples.subarray(i,i+128)]]);
  assert.equal(w.sent.length,Math.floor(expected.length/8));
  for(const message of w.sent){const f=expected[Math.round(message.t*sr/128)-1];assert.equal(message.level,f.level);assert.equal(message.db,f.db);assert.equal(message.fast_db,f.fast_db);assert.equal(message.voice,f.voice);}
  parity.push({audio:name,mensajes_identicos:w.sent.length});
}
const w=new Worklet();w.port.onmessage({data:{method:winnerId,config}});w.port.onmessage({data:{calibrate:true}});
for(let i=0;i<cal.length;i+=128)w.process([[cal.subarray(i,i+128)]]);
assert.deepEqual(w.sent.find(m=>m.calibration)?.calibration,cal,'Capturar exactamente 10 s de PCM continuo');
for(const m of methods){w.port.onmessage({data:{method:m.id,config:calibrate(cal,m.id)}});w.process([[zero]]);assert.equal(w.processor.method.id,m.id);}
const result={estado:'OK',fecha:new Date().toISOString(),metodos_anteriores:'trazas idénticas',pausa_corta:'conservada',silencio_sostenido:'nivel 1',subida_sin_silencio_ms:hit*1000,paridad_worklet_simulado:parity,calibracion_pcm:'10 s idénticos',cambio_metodos:methods.length,navegador:'pendiente: Chrome rechazado por sandbox (spawn EPERM)'};
fs.writeFileSync(new URL('./verificacion.json',import.meta.url),JSON.stringify(result,null,2)+'\n');console.log(JSON.stringify(result));
