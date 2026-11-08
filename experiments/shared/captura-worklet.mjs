import {RMS,LUFS,Levels,SyllableCounter} from './dsp.mjs';
// Audio de micrófono nunca se devuelve a los altavoces.
class CaptureProcessor extends AudioWorkletProcessor {
  constructor(){super();this.rms=new RMS(sampleRate);this.lufs=sampleRate===48000?new LUFS():null;this.levels=new Levels();this.syllables=new SyllableCounter(sampleRate);this.frames=0;this.last=0;
    this.port.onmessage=e=>{if(e.data.config)this.levels=new Levels(e.data.config);};
  }
  process(inputs,outputs){
    const x=inputs[0]?.[0];if(!x)return true;
    const levelDb=this.rms.process(x),lu=this.lufs?.process(x),level=this.levels.process(levelDb),speed=this.syllables.process(x);
    this.frames+=x.length;
    // Mensajes cada 8 bloques para medir intervalo sin saturar el hilo principal.
    if(this.frames-this.last>=1024){this.last=this.frames;this.port.postMessage({frame:currentFrame,t:currentTime,rms:levelDb,lufs:lu,level,speed,bloque:x.length});}
    return true;
  }
}
registerProcessor('captura',CaptureProcessor);
