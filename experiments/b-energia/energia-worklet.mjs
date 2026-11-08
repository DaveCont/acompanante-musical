import {Energy} from './energia.mjs';

class EnergyWorklet extends AudioWorkletProcessor {
  constructor() {
    super();this.frames=0;this.last=0;this.recording=null;
    this.port.onmessage=({data})=>{
      if(data.method){this.processor=new Energy(data.method,sampleRate,data.config);}
      if(data.calibrate){this.recording=new Float32Array(10*sampleRate);this.recorded=0;}
    };
  }
  process(inputs) {
    const x=inputs[0]?.[0];if(!x||!this.processor)return true;
    this.processor.process(x);this.frames+=x.length;
    if(this.recording){
      const n=Math.min(x.length,this.recording.length-this.recorded);
      this.recording.set(x.subarray(0,n),this.recorded);this.recorded+=n;
      if(this.recorded===this.recording.length){
        // La calibración se calcula en el hilo principal, fuera del hilo de audio.
        this.port.postMessage({calibration:this.recording},[this.recording.buffer]);this.recording=null;
      }
    }
    if(this.frames-this.last>=1024){
      this.last=this.frames;
      const p=this.processor;
      this.port.postMessage({t:this.frames/sampleRate,db:p.value,fast_db:p.fastDb,level:p.level,voice:p.voice,silencio_s:p.silent,calibracion_s:this.recording?this.recorded/sampleRate:null,bloque:x.length});
    }
    return true;
  }
}
registerProcessor('energia',EnergyWorklet);
