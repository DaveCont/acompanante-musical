import {audio,json,bench,report,round,kb} from '../shared/node.mjs';
import {mean,percentile} from '../shared/dsp.mjs';
import {Energy,methods,calibrate,energyTrace,winnerId} from './energia.mjs';
import fs from 'node:fs';

const timeline=json('sermon-simulado.json'),cal=audio('calibracion.wav');
const fixtures=['sermon-simulado.wav','sermon-con-musica.wav'].map(name=>({name,...audio(name)}));
if(cal.sampleRate!==48000||fixtures.some(f=>f.sampleRate!==48000))throw Error('Fixtures esperados a 48 kHz.');

export function score(t) {
  let correct=0,total=0,stableCorrect=0,stableN=0,flashes=0;
  const reaction=[],up=[],missed=[],reactions=[];
  for(let si=0;si<timeline.length;si++){
    const s=timeline[si],frames=t.filter(f=>f.t>s.inicio_s&&f.t<=s.fin_s);let hit=null,run=0;
    // Primera coincidencia sostenida 100 ms; 38 bloques a 48 kHz.
    for(let i=0;i<frames.length;i++){
      run=frames[i].level===s.nivel_esperado?run+1:0;
      if(run>=38){hit=frames[i-37].t;break;}
    }
    const changed=si>0&&timeline[si-1].nivel_esperado!==s.nivel_esperado;
    const rising=changed&&s.nivel_esperado>timeline[si-1].nivel_esperado;
    reactions.push({inicio_s:s.inicio_s,nivel:s.nivel_esperado,subida:rising,reaccion_ms:hit===null?null:round((hit-s.inicio_s)*1000)});
    if(hit!==null&&changed){reaction.push((hit-s.inicio_s)*1000);if(rising)up.push((hit-s.inicio_s)*1000);}
    if(hit===null)missed.push(s.inicio_s);
    frames.forEach((f,i)=>{total++;if(f.level===s.nivel_esperado)correct++;
      if(f.t>s.inicio_s+.8){stableN++;if(f.level===s.nivel_esperado)stableCorrect++;if(i&&f.level!==frames[i-1].level)flashes++;}
    });
  }
  return {acierto_pct:round(100*correct/total),acierto_estable_pct:round(100*stableCorrect/stableN),reaccion_mediana_ms:round(percentile(reaction,.5)),reaccion_media_ms:round(mean(reaction)),reaccion_subida_mediana_ms:round(percentile(up,.5)),reaccion_subida_max_ms:round(up.length?Math.max(...up):null),subidas_detectadas:up.length,subidas_esperadas:4,parpadeos_fuera_transicion:flashes,segmentos_sin_acierto_sostenido:missed,reacciones:reactions};
}

function step(id,config){
  const p=new Energy(id,48000,config),sig=new Float32Array(96000),values=[];
  for(let i=0;i<sig.length;i++)sig[i]=Math.SQRT2*10**((i<48000?-30:-10)/20)*Math.sin(2*Math.PI*1000*i/48000);
  for(let i=0;i<sig.length;i+=128){p.process(sig.subarray(i,i+128));values.push({t:(i+128)/48000,db:p.value,fast:p.fastDb});}
  const settle=key=>{const target=mean(values.filter(v=>v.t>1.8).map(v=>v[key]));const hit=values.find(v=>v.t>=1&&Math.abs(v[key]-target)<=1);return hit?round((hit.t-1)*1000):null;};
  return {reaccion_1db_ms:settle('db'),energia_rapida_1db_ms:settle('fast')};
}

const rows=[];
for(const m of methods){
  const config=calibrate(cal.samples,m.id),tests={};
  for(const f of fixtures)tests[f.name]=score(energyTrace(f.samples,m.id,config));
  // Camino completo, recorriendo también pausas, con memoria ya reservada.
  const p=new Energy(m.id,48000,config),x=fixtures[1].samples;let pos=0;
  const cpu=bench(()=>{p.process(x.subarray(pos,pos+128));pos=(pos+128)%x.length;},x.length/128);
  rows.push({id:m.id,nombre:m.nombre,parametros:m,calibracion:config,...tests['sermon-simulado.wav'],con_musica:tests['sermon-con-musica.wav'],escalon:step(m.id,config),cpu_128:cpu});
}

const table=music=>`|Método|Acierto %|Tras 800 ms %|Reacción mediana ms|Subida med./máx. ms|Subidas detectadas|Cruda 1 dB ms|Parpadeos|CPU ms/128|\n|---|---:|---:|---:|---:|---:|---:|---:|---:|\n${rows.map(r=>{const s=music?r.con_musica:r;return `|${r.nombre}|${s.acierto_pct}|${s.acierto_estable_pct}|${s.reaccion_mediana_ms}|${s.reaccion_subida_mediana_ms} / ${s.reaccion_subida_max_ms}|${s.subidas_detectadas}/${s.subidas_esperadas}|${r.escalon.energia_rapida_1db_ms}|${s.parpadeos_fuera_transicion}|${r.cpu_128.media_ms}|`;}).join('\n')}`;
const win=rows.find(r=>r.id===winnerId);
const body=`Calibración independiente: exactamente 10 s de calibracion.wav (5 normal + 5 fuerte), sin usar las etiquetas del sermón para calcular umbrales. Se conservan los cuatro métodos anteriores y su calibración p65/histéresis 1,5 dB. La mezcla usa los mismos umbrales sin compensar su atenuación ni restar una referencia.

## Voz neural sola

${table(false)}

## Sermón con música

${table(true)}

## Parámetros y medición

Pasaaltos Butterworth 100 Hz (segundo orden). RMS asimétrico sobre potencia. Se prueban attack/release 30/800, 50/1500 y 80/2500 ms. VAD por umbral relativo: p65 de la envolvente rápida normal menos 18 dB, apertura/cierre ±1 dB. Hold congela el nivel mientras no hay voz durante 1500 ms; luego vuelve directamente a 1. No es un separador de voz y música.

Percentil causal p85 sobre 1500 ms de reloj, únicamente bloques con voz; histograma de 0,25 dB, sin relleno futuro. Su envolvente tiene attack/release 30/80 ms. Híbrido: HP100 + esa envolvente + VAD/hold + p85 + histéresis 1,5 dB. Ventana parcial al arrancar, sin esperar a llenarla.

Acierto total incluye arranques y todos los silencios etiquetados 1; acierto tras 800 ms excluye solo los primeros 800 ms de cada segmento. Reacción: primera coincidencia correcta sostenida 100 ms; mediana general incluye bajadas deliberadamente lentas. Subida se informa aparte (4 transiciones); fallos y reacciones individuales están en JSON. Parpadeos: cambios de nivel después de los primeros 800 ms del segmento, incluyendo descensos de silencio.

Se mantiene la definición del script anterior: mediana = p50 discreto inferior, sin interpolación. Las reacciones nulas no entran en el p50: por eso se informa cuántas subidas fueron detectadas. El híbrido detecta 4/4 subidas en voz sola y 2/4 con música; los dos segmentos de nivel 4 de la mezcla nunca alcanzan acierto sostenido. La mezcla atenúa toda la voz (véase ground-truth.json); no se ajustan umbrales con esa información. La meta ≥90% y subida <400 ms se cumple en voz sola, no con música.

Cruda: salida rápida independiente para golpes (HP si corresponde, RMS 30/80 ms), tiempo hasta quedar a 1 dB del destino en escalón senoidal 1 kHz de −30 a −10 dBFS. No usa percentil ni hold. No equivale a latencia acústica ni de salida. También se guarda el escalón de clasificación en JSON. Cuantización temporal: 2,667 ms. CPU: media y p95 en JSON, todos los bloques de la mezcla, camino completo incluido clasificador.

## Recomendación (3 líneas)

Elegir ${win.nombre}: ${win.acierto_pct}% de acierto y ${win.parpadeos_fuera_transicion} parpadeos en voz sola.  
Usar salida rápida RMS 30/80 ms para golpes y salida estabilizada para niveles; mantener calibración de 10 s.  
Con música alcanza ${win.con_musica.acierto_pct}% y falla 2 subidas: mejorar discriminación de voz/pad y validar micrófono/PA real y tablet.

## Verificación y pendientes

Ejecutado node experiments/b-energia/verificar.mjs: trazas anteriores idénticas; pausa corta conservada; descenso por silencio; subida continua sin pausa en 242,667 ms. Paridad exacta del worklet simulado con Node: 5625 mensajes por cada audio; calibración de PCM continuo de 10 s idéntica y cambio de los 10 métodos. Evidencia: [verificacion.json](./verificacion.json).

La página selecciona el ganador por defecto, permite todos los métodos y aplica la misma calibración por método tanto en vivo como al medir WAV. La validación real de navegador está pendiente: node experiments/b-energia/verificar-navegador.mjs no pudo lanzar Chrome por el sandbox (spawn EPERM); no se afirma prueba visual ni de audio del navegador. La revisión cruzada con Claude se intentó y la aprobación automática del MCP la rechazó porque la política de esta sesión no permite aprobaciones. Sin commit.

DSP local ${kb('b-energia/energia.mjs')} KiB + compartido ${kb('shared/dsp.mjs')} KiB. Ejecutar: node experiments/b-energia/medir.mjs.`;
const verificationURL=new URL('./verificacion.json',import.meta.url);
const verification=fs.existsSync(verificationURL)?JSON.parse(fs.readFileSync(verificationURL,'utf8')):null;
report('b-energia',{ganador:winnerId,comparacion:rows,verificacion_local:verification},body);
