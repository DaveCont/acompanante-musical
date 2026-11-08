// DSP compartido entre Node y navegador; todas las magnitudes en PCM normalizado.
export const db = x => 20 * Math.log10(Math.max(x, 1e-12));
export const rms = x => Math.sqrt(x.reduce((s, v) => s + v*v, 0) / Math.max(1, x.length));
export const mean = x => x.length ? x.reduce((s,v)=>s+v,0)/x.length : null;
export const percentile = (x,p) => x.length ? [...x].sort((a,b)=>a-b)[Math.min(x.length-1,Math.floor(p*(x.length-1)))] : null;

export class RMS {
  constructor(sr=48000, attack=.02, release=.3) {
    this.sr=sr; this.attack=attack; this.release=release; this.power=0;
  }
  process(x) {
    let p=0; for(const v of x) p+=v*v; p/=x.length;
    const alpha=Math.exp(-x.length/(this.sr*(p>this.power?this.attack:this.release)));
    this.power=alpha*this.power+(1-alpha)*p;
    return db(Math.sqrt(this.power));
  }
}

// Coeficientes BS.1770 a 48 kHz; shelf + pasaaltos. LUFS momentáneo mono,
// sin puertas de loudness integrado ni pretensión de certificación.
class Biquad {
  constructor(b,a) {this.b=b;this.a=a;this.x1=this.x2=this.y1=this.y2=0;}
  sample(x) {
    const y=this.b[0]*x+this.b[1]*this.x1+this.b[2]*this.x2-this.a[1]*this.y1-this.a[2]*this.y2;
    this.x2=this.x1;this.x1=x;this.y2=this.y1;this.y1=y;return y;
  }
}
export class LUFS {
  constructor(sr=48000) {
    if(sr!==48000) throw Error('K-weighting implementado a 48 kHz; remuestrear entrada.');
    this.shelf=new Biquad([1.53512485958697,-2.69169618940638,1.19839281085285],[1,-1.69065929318241,.73248077421585]);
    this.high=new Biquad([1,-2,1],[1,-1.99004745483398,.99007225036621]);
    this.ring=new Float64Array(Math.round(.4*sr));this.sum=0;this.pos=0;
  }
  process(x) {
    for(const v of x) {
      const k=this.high.sample(this.shelf.sample(v)), p=k*k;
      this.sum+=p-this.ring[this.pos];this.ring[this.pos]=p;this.pos=(this.pos+1)%this.ring.length;
    }
    return -.691+10*Math.log10(Math.max(this.sum/this.ring.length,1e-24));
  }
}

export function calibration(x,sr=48000) {
  if(x.length<10*sr) throw Error('Calibración requiere 10 s: 5 s normal y 5 s fuerte.');
  const p=new RMS(sr),values=[];
  for(let i=0;i+128<=x.length;i+=128)values.push({t:(i+128)/sr,db:p.process(x.subarray(i,i+128))});
  const normal=percentile(values.filter(v=>v.t>=1&&v.t<=5).map(v=>v.db),.65),fuerte=percentile(values.filter(v=>v.t>=6).map(v=>v.db),.65);
  const gap=Math.max(4,fuerte-normal);
  return {normal_db:normal,fuerte_db:fuerte,thresholds:[normal-gap*.75,(normal+fuerte)/2,fuerte+gap*.55],hysteresis_db:1.5};
}
export class Levels {
  constructor(config={thresholds:[-24,-14,-7],hysteresis_db:1.5}) {this.config=config;this.level=1;}
  process(value) {
    const {thresholds:t,hysteresis_db:h}=this.config;
    while(this.level<4 && value>t[this.level-1]+h/2) this.level++;
    while(this.level>1 && value<t[this.level-2]-h/2) this.level--;
    return this.level;
  }
}

export function trace(x,processor,sr=48000,config) {
  const out=[],levels=new Levels(config);
  for(let i=0;i<x.length;i+=128) {
    const value=processor.process(x.subarray(i,i+128));
    out.push({t:Math.min(i+128,x.length)/sr,db:value,level:levels.process(value)});
  }
  return out;
}

// YIN: diferencia acumulada normalizada, primer mínimo bajo umbral y parábola.
export function yin(x,sr=48000) {
  if(rms(x)<.003) return null;
  const min=Math.floor(sr/1000), max=Math.min(Math.floor(sr/65),Math.floor(x.length/2)-1);
  const d=new Float64Array(max+1),n=x.length-max;
  let cumulative=0;
  for(let tau=1;tau<=max;tau++) {
    let sum=0;for(let i=0;i<n;i++){const delta=x[i]-x[i+tau];sum+=delta*delta;}
    cumulative+=sum;d[tau]=cumulative?sum*tau/cumulative:1;
    if(tau>min+1 && d[tau-1]<.15 && d[tau]>=d[tau-1]) {
      const k=tau-1,den=d[k-1]-2*d[k]+d[k+1];
      return sr/(k+(den?.5*(d[k-1]-d[k+1])/den:0));
    }
  }
  let k=min;for(let i=min;i<=max;i++) if(d[i]<d[k]) k=i;
  return d[k]<.3?sr/k:null;
}
export function autocorrelation(x,sr=48000) {
  if(rms(x)<.003) return null;
  const min=Math.floor(sr/1000),max=Math.min(Math.floor(sr/65),Math.floor(x.length/2)-1),n=x.length-max;
  const c=new Float64Array(max+1);
  let best=0, lag=0;
  for(let t=min;t<=max;t++) {
    let dot=0,a=0,b=0;
    for(let i=0;i<n;i++){dot+=x[i]*x[i+t];a+=x[i]*x[i];b+=x[i+t]*x[i+t];}
    c[t]=dot/Math.sqrt(a*b+1e-30);
  }
  // Primer máximo suficientemente alto evita preferir múltiplos del período.
  for(let t=min+1;t<max;t++) if(c[t]>.85 && c[t]>c[t-1] && c[t]>=c[t+1]){lag=t;best=c[t];break;}
  if(!lag) for(let t=min;t<=max;t++) if(c[t]>best){lag=t;best=c[t];}
  if(best<.5) return null;
  const den=(c[lag-1]??0)-2*c[lag]+(c[lag+1]??0);
  return sr/(lag+(den?.5*((c[lag-1]??0)-(c[lag+1]??0))/den:0));
}

export class SyllableCounter {
  constructor(sr=48000) {this.sr=sr;this.energy=0;this.count=0;this.index=0;this.a=0;this.b=0;this.last=-1;this.peaks=[];this.floor=0;}
  process(x) {
    // Envolvente a 100 Hz; banda aproximada 2–10 Hz: diferencia de dos LP.
    for(const v of x){this.energy+=v*v;this.count++;this.index++;
      if(this.count>=this.sr/100){
        const e=Math.sqrt(this.energy/this.count);this.energy=0;this.count=0;
        this.lp10=(this.lp10??0)+(1-Math.exp(-2*Math.PI*10/100))*(e-(this.lp10??0));
        this.lp2=(this.lp2??0)+(1-Math.exp(-2*Math.PI*2/100))*(e-(this.lp2??0));
        const z=this.lp10-this.lp2,t=this.index/this.sr;
        this.floor=.98*this.floor+.02*e;
        if(this.b>this.a && this.b>=z && this.b>Math.max(.001,this.floor*.12) && t-this.last>=.1){this.peaks.push(t-.01);this.last=t;}
        this.a=this.b;this.b=z;
      }
    }
    const now=this.index/this.sr;return this.peaks.filter(t=>t>now-1).length;
  }
}
export function syllablePeaks(x,sr=48000){const c=new SyllableCounter(sr);c.process(x);return c.peaks;}
