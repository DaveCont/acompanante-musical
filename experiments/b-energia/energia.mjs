import {RMS, LUFS, Levels, percentile} from '../shared/dsp.mjs';

// Registro único: Node y AudioWorklet ejecutan exactamente los mismos métodos.
export const methods = [
  {id:'rms10', nombre:'RMS 10/200', attack:.01, release:.2, legacy:true},
  {id:'rms20', nombre:'RMS 20/300', attack:.02, release:.3, legacy:true},
  {id:'rms30', nombre:'RMS 30/400', attack:.03, release:.4, legacy:true},
  {id:'lufs', nombre:'LUFS K 400ms', legacy:true},
  {id:'hp30', nombre:'HP100 RMS 30/800', hp:true, attack:.03, release:.8},
  {id:'hp50', nombre:'HP100 RMS 50/1500', hp:true, attack:.05, release:1.5},
  {id:'hp80', nombre:'HP100 RMS 80/2500', hp:true, attack:.08, release:2.5},
  {id:'vad', nombre:'VAD hold 1500', attack:.03, release:.3, hold:1.5},
  {id:'p85', nombre:'Voz p85 1500ms', attack:.03, release:.08, window:1.5, percentile:.85},
  {id:'hybrid', nombre:'HP100 + VAD + p85', hp:true, attack:.03, release:.08, hold:1.5, window:1.5, percentile:.85},
];
export const winnerId = 'hybrid';

// Pasaaltos Butterworth de segundo orden; coeficientes según sampleRate real.
class HighPass {
  constructor(sr) {
    const w=2*Math.PI*100/sr, c=Math.cos(w), a=Math.sin(w)/Math.SQRT2, d=1+a;
    this.b0=(1+c)/2/d; this.b1=-(1+c)/d; this.b2=this.b0;
    this.a1=-2*c/d; this.a2=(1-a)/d;
    this.x1=this.x2=this.y1=this.y2=0;
  }
  sample(x) {
    const y=this.b0*x+this.b1*this.x1+this.b2*this.x2-this.a1*this.y1-this.a2*this.y2;
    this.x2=this.x1;this.x1=x;this.y2=this.y1;this.y1=y;return y;
  }
}

// Histograma circular de 0,25 dB: memoria fija, sin ordenar ni asignar por bloque.
class VoicePercentile {
  constructor(sr,seconds,p) {
    this.slots=new Int16Array(Math.ceil(seconds*sr/128));this.slots.fill(-1);
    this.hist=new Uint16Array(481);this.pos=0;this.count=0;this.p=p;
  }
  process(value,voice) {
    const old=this.slots[this.pos];if(old>=0){this.hist[old]--;this.count--;}
    const bin=voice?Math.max(0,Math.min(480,Math.round((value+120)*4))):-1;
    this.slots[this.pos]=bin;if(bin>=0){this.hist[bin]++;this.count++;}
    this.pos=(this.pos+1)%this.slots.length;
    if(!this.count)return -120;
    const rank=Math.floor(this.p*(this.count-1));let n=0;
    for(let i=0;i<this.hist.length;i++){n+=this.hist[i];if(n>rank)return i/4-120;}
    return -120;
  }
}

export class Energy {
  constructor(id,sr=48000,config=null) {
    this.method=methods.find(m=>m.id===id);if(!this.method)throw Error('Método desconocido: '+id);
    const m=this.method;this.sr=sr;this.config=config;
    this.env=id==='lufs'?new LUFS(sr):new RMS(sr,m.attack,m.release);
    this.fast=new RMS(sr,.03,.08);this.filter=m.hp?new HighPass(sr):null;
    this.filtered=new Float32Array(128);this.levels=new Levels(config??undefined);
    this.percent=m.window?new VoicePercentile(sr,m.window,m.percentile):null;
    this.silent=0;this.voice=false;this.fastDb=-240;this.value=-240;this.level=1;
  }
  process(x) {
    let input=x;
    if(this.filter){for(let i=0;i<x.length;i++)this.filtered[i]=this.filter.sample(x[i]);input=x.length===128?this.filtered:this.filtered.subarray(0,x.length);}
    this.fastDb=this.fast.process(input);
    const env=this.env.process(input),m=this.method,dt=x.length/this.sr;
    // Umbral relativo obtenido exclusivamente de los 10 s de calibración.
    const gate=this.config?.vad_db??-45;
    this.voice=this.fastDb>gate+(this.voice?-1:1);
    this.silent=this.voice?0:this.silent+dt;
    this.value=this.percent?this.percent.process(env,this.voice):env;
    if(this.config){
      if(m.hold&&!this.voice){
        if(this.silent>=m.hold){this.levels.level=1;this.level=1;}
      }else this.level=this.levels.process(this.value);
    }
    return this.value;
  }
}

export function calibrate(samples,id,sr=48000) {
  if(samples.length!==10*sr)throw Error('Se requieren exactamente 10 s de calibración.');
  const p=new Energy(id,sr),normal=[],strong=[],fast=[];
  for(let i=0;i<samples.length;i+=128){
    const value=p.process(samples.subarray(i,i+128)),t=(i+128)/sr;
    if(t>=1&&t<=5){normal.push(value);fast.push(p.fastDb);}
    if(t>=6)strong.push(value);
  }
  const n=percentile(normal,.65),h=percentile(strong,.65),gap=Math.max(4,h-n);
  const config={normal_db:n,fuerte_db:h,thresholds:[n-.75*gap,(n+h)/2,h+.55*gap],hysteresis_db:1.5,vad_db:percentile(fast,.65)-18};
  // Segunda pasada para percentiles: la selección de voz usa el umbral calibrado.
  if(p.method.window){
    const q=new Energy(id,sr,config);normal.length=0;strong.length=0;
    for(let i=0;i<samples.length;i+=128){const v=q.process(samples.subarray(i,i+128)),t=(i+128)/sr;if(t>=1&&t<=5)normal.push(v);if(t>=6)strong.push(v);}
    const a=percentile(normal,.65),b=percentile(strong,.65),g=Math.max(4,b-a);
    Object.assign(config,{normal_db:a,fuerte_db:b,thresholds:[a-.75*g,(a+b)/2,b+.55*g]});
  }
  return config;
}

export function energyTrace(samples,id,config,sr=48000) {
  const p=new Energy(id,sr,config),out=[];
  for(let i=0;i<samples.length;i+=128){p.process(samples.subarray(i,i+128));out.push({t:Math.min(i+128,samples.length)/sr,db:p.value,fast_db:p.fastDb,voice:p.voice,level:p.level});}
  return out;
}
