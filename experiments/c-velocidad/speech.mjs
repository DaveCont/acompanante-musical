// La presencia de SpeechRecognition no demuestra funcionamiento sin conexión.
const API=window.SpeechRecognition??window.webkitSpeechRecognition,events=[];let recognition;
function log(event,data={}){events.push({fecha:new Date().toISOString(),evento:event,online:navigator.onLine,...data});document.querySelector('#result').textContent=JSON.stringify(events,null,2);}
log('disponibilidad',{api:!!API,contexto_seguro:isSecureContext,userAgent:navigator.userAgent});
document.querySelector('#start').onclick=()=>{if(!API){log('no disponible');return;}recognition?.abort();recognition=new API();recognition.lang='es-MX';recognition.interimResults=true;recognition.continuous=false;const local='processLocally' in recognition;
  if(local)recognition.processLocally=document.querySelector('#local').checked;
  log('inicio solicitado',{processLocally_soportado:local,processLocally:local?recognition.processLocally:null});
  recognition.onresult=e=>log('resultado',{texto:Array.from(e.results,r=>r[0].transcript).join(' '),final:Array.from(e.results).some(r=>r.isFinal)});
  recognition.onerror=e=>log('error',{error:e.error,mensaje:e.message});recognition.onend=()=>log('fin');
  try{recognition.start();}catch(e){log('excepcion',{mensaje:e.message});}
};
document.querySelector('#stop').onclick=()=>recognition?.stop();document.querySelector('#save').onclick=()=>{const url=URL.createObjectURL(new Blob([JSON.stringify(events,null,2)],{type:'application/json'})),a=document.createElement('a');a.href=url;a.download='speech-wifi.json';a.click();setTimeout(()=>URL.revokeObjectURL(url),5000);};
