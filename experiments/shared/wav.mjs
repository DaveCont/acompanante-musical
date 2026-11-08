// Lector/escritor RIFF con chunks arbitrarios; PCM16 mono a 48 kHz en fixtures.
export function decodeWav(buffer) {
  const v=new DataView(buffer.buffer??buffer,buffer.byteOffset??0,buffer.byteLength);
  const str=(p,n)=>String.fromCharCode(...new Uint8Array(v.buffer,v.byteOffset+p,n));
  if(str(0,4)!=='RIFF'||str(8,4)!=='WAVE') throw Error('Se requiere WAV RIFF.');
  let fmt,data;
  for(let p=12;p+8<=v.byteLength;){const tag=str(p,4),n=v.getUint32(p+4,true);
    if(tag==='fmt ')fmt={format:v.getUint16(p+8,true),channels:v.getUint16(p+10,true),sampleRate:v.getUint32(p+12,true),bits:v.getUint16(p+22,true)};
    if(tag==='data')data={start:p+8,length:n};p+=8+n+(n%2);
  }
  if(!fmt||!data||fmt.format!==1||fmt.bits!==16||fmt.channels!==1)throw Error('Usar WAV PCM16 mono.');
  const samples=new Float32Array(data.length/2);for(let i=0;i<samples.length;i++)samples[i]=v.getInt16(data.start+i*2,true)/32768;
  return {...fmt,samples};
}
export function encodeWav(samples,sr=48000) {
  const out=new ArrayBuffer(44+samples.length*2),v=new DataView(out);
  const put=(p,s)=>{for(let i=0;i<s.length;i++)v.setUint8(p+i,s.charCodeAt(i));};
  put(0,'RIFF');v.setUint32(4,out.byteLength-8,true);put(8,'WAVE');put(12,'fmt ');v.setUint32(16,16,true);v.setUint16(20,1,true);v.setUint16(22,1,true);v.setUint32(24,sr,true);v.setUint32(28,sr*2,true);v.setUint16(32,2,true);v.setUint16(34,16,true);put(36,'data');v.setUint32(40,samples.length*2,true);
  samples.forEach((s,i)=>v.setInt16(44+i*2,Math.round(Math.max(-1,Math.min(1,s))*32767),true));return out;
}
