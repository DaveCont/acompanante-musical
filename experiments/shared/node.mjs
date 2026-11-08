import fs from 'node:fs';
import os from 'node:os';
import {fileURLToPath} from 'node:url';
import {performance} from 'node:perf_hooks';
import {decodeWav} from './wav.mjs';
import {mean,percentile} from './dsp.mjs';
export const ROOT=fileURLToPath(new URL('../../',import.meta.url));
export const audio=name=>decodeWav(fs.readFileSync(ROOT+'test-audio/'+name));
export const json=name=>JSON.parse(fs.readFileSync(ROOT+'test-audio/'+name,'utf8'));
export const round=(n,d=3)=>Number.isFinite(n)?+n.toFixed(d):null;
export const kb=p=>fs.existsSync(ROOT+'experiments/'+p)?round(fs.statSync(ROOT+'experiments/'+p).size/1024):null;
export function bench(fn,iterations=300){for(let i=0;i<20;i++)fn();const times=[];for(let i=0;i<iterations;i++){const t=performance.now();fn();times.push(performance.now()-t);}return {media_ms:round(mean(times),6),p95_ms:round(percentile(times,.95),6),iteraciones:iterations};}
export function report(folder,result,body){
  const env={fecha:new Date().toISOString(),node:process.version,cpu:os.cpus()[0].model,plataforma:process.platform};
  const doc={entorno:env,...result};
  fs.writeFileSync(ROOT+`experiments/${folder}/resultados.json`,JSON.stringify(doc,null,2)+'\n');
  fs.writeFileSync(ROOT+`experiments/${folder}/RESULTADOS.md`,`# Resultados: ${folder}\n\n${body}\n\nMedido ${env.fecha}; ${env.node}; ${env.cpu}. Bloque de audio: 128 muestras / 48 kHz = 2,667 ms. CPU de Node no equivale a tablet.\n\nDatos completos: [resultados.json](./resultados.json).\n`);
  console.log(folder,JSON.stringify(result));return doc;
}
export function available(name){try{return import.meta.resolve(name);}catch{return null;}}
