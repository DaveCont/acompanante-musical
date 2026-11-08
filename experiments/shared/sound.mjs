// Progresión I-V-vi-IV: Do y Sol; la misma función sirve en tiempo real y offline.
export const LOOP_SECONDS=8;
const midiHz=m=>440*2**((m-69)/12);
function tone(ctx,out,hz,start,duration,type,gain,detune=0,filter=null){
  const osc=ctx.createOscillator(),amp=ctx.createGain();osc.type=type;osc.frequency.value=hz;osc.detune.value=detune;
  amp.gain.setValueAtTime(0,start);amp.gain.linearRampToValueAtTime(gain,start+.08);amp.gain.setValueAtTime(gain,Math.max(start+.08,start+duration-.2));amp.gain.linearRampToValueAtTime(0,start+duration);
  if(filter){const f=ctx.createBiquadFilter();f.type='lowpass';f.frequency.value=filter;osc.connect(f).connect(amp);}else osc.connect(amp);
  amp.connect(out);osc.start(start);osc.stop(start+duration+.01);
}
let randomSeed=12345;
function noise(ctx,out,start,duration,gain,cutoff){
  const b=ctx.createBuffer(1,Math.ceil(duration*ctx.sampleRate),ctx.sampleRate),d=b.getChannelData(0);
  for(let i=0;i<d.length;i++){randomSeed=(Math.imul(1664525,randomSeed)+1013904223)>>>0;d[i]=(randomSeed/4294967296*2-1)*Math.exp(-i/(d.length*.18));}
  const source=ctx.createBufferSource(),filter=ctx.createBiquadFilter(),amp=ctx.createGain();source.buffer=b;filter.type='highpass';filter.frequency.value=cutoff;amp.gain.value=gain;source.connect(filter).connect(amp).connect(out);source.start(start);
}
// destination opcional: permite pasar la música por un control de volumen propio (h-celular).
export function scheduleProgression(ctx,key='Do',start=ctx.currentTime+.1,destination=ctx.destination){
  const master=ctx.createGain();master.gain.value=.65;master.connect(destination);
  const transpose=key==='Sol'?7:0,chords=[[48,52,55],[43,47,50],[45,48,52],[41,45,48]];
  const cpuStart=performance.now();
  chords.forEach((chord,j)=>{for(const note of chord){for(const detune of [-7,7])tone(ctx,master,midiHz(note+transpose),start+j*2,2,'sawtooth',.018,detune,1400);}
    tone(ctx,master,midiHz(chord[0]-12+transpose),start+j*2,1.9,'sine',.16);
  });
  for(let i=0;i<16;i++){
    const t=start+i*.5,osc=ctx.createOscillator(),amp=ctx.createGain();osc.frequency.setValueAtTime(135,t);osc.frequency.exponentialRampToValueAtTime(42,t+.14);amp.gain.setValueAtTime(.25,t);amp.gain.exponentialRampToValueAtTime(.0001,t+.23);osc.connect(amp).connect(master);osc.start(t);osc.stop(t+.24);
    noise(ctx,master,t+.25,.09,.08,6500);
  }
  noise(ctx,master,start,.9,.12,3000);
  return {programacion_ms:performance.now()-cpuStart,fin_s:start+LOOP_SECONDS};
}
export async function renderLoop(key='Do'){
  randomSeed=12345;
  const ctx=new OfflineAudioContext(1,Math.round((LOOP_SECONDS+.25)*48000),48000),data=scheduleProgression(ctx,key,0);
  const t=performance.now(),buffer=await ctx.startRendering();
  return {buffer,programacion_ms:data.programacion_ms,render_ms:performance.now()-t};
}
export function scheduleClick(ctx,time,destination=ctx.destination){
  const o=ctx.createOscillator(),g=ctx.createGain();o.frequency.value=1000;g.gain.setValueAtTime(.15,time);g.gain.exponentialRampToValueAtTime(.00001,time+.008);o.connect(g).connect(destination);o.start(time);o.stop(time+.01);
}
export async function jitterTest(mode='propio',count=200,interval=.02){
  const records=[],timers=[],dispatch=[],ctx=new AudioContext({sampleRate:48000});await ctx.resume();
  let done=false,transport=null,tone=null;
  const started=performance.now(),start=ctx.currentTime+.15;
  if(mode==='tone'){
    tone=await import('../vendor/tone.min.js');tone.setContext(ctx);await tone.start();transport=tone.getTransport();transport.bpm.value=120;
    let i=0;
    const id=transport.scheduleRepeat(time=>{if(i>=count)return;const expected=start+i*interval;const now=ctx.currentTime;scheduleClick(ctx,time);records.push({i,esperado_s:expected,programado_s:time,error_ms:(time-expected)*1000,margen_ms:(time-now)*1000});i++;},interval,0);
    transport.start(start);
    await new Promise(resolve=>{const timer=setInterval(()=>{if(records.length>=count){clearInterval(timer);transport.clear(id);transport.stop();resolve();}},25);});
  }else{
    let i=0,last=performance.now();
    await new Promise(resolve=>{const tick=()=>{
      const now=ctx.currentTime,t=performance.now();dispatch.push(t-last);last=t;
      while(i<count&&start+i*interval<now+.1){const expected=start+i*interval,scheduled=Math.max(expected,now);scheduleClick(ctx,scheduled);records.push({i,esperado_s:expected,programado_s:scheduled,error_ms:(scheduled-expected)*1000,margen_ms:(expected-now)*1000});i++;}
      if(i>=count){resolve();return;}timers.push(setTimeout(tick,25));};tick();});
  }
  // Conservar el contexto hasta que se hayan ejecutado los últimos golpes.
  await new Promise(r=>setTimeout(r,Math.max(0,(start+count*interval-ctx.currentTime)*1000+50)));
  await ctx.close();done=true;
  return {metodo:mode,golpes:records.length,intervalo_ms:interval*1000,duracion_real_ms:performance.now()-started,records,intervalos_callback_ms:dispatch,nota:'Jitter del tiempo programado y del callback; no mide latencia acústica. Lookahead 100 ms, timer 25 ms.'};
}
