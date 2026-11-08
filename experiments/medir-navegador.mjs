// CDP y WebSocket nativos de Node; solo servidor local y micrófono falso por WAV.
import fs from 'node:fs';
import path from 'node:path';
import {spawn} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {createServer} from './servidor.mjs';
const dir=path.dirname(fileURLToPath(import.meta.url)),root=path.dirname(dir),profile=path.join(dir,'.browser');
fs.mkdirSync(profile,{recursive:true});
const chrome=process.env.CHROME_PATH??'C:/Program Files/Google/Chrome/Application/chrome.exe';
const server=createServer();
await new Promise((resolve,reject)=>{server.on('error',reject);server.listen(0,'127.0.0.1',resolve);});
const port=server.address().port,base=`http://127.0.0.1:${port}`;
const args=['--headless=new','--no-sandbox','--disable-gpu','--disable-background-networking','--disable-component-update','--disable-sync','--no-first-run','--no-default-browser-check',`--user-data-dir=${profile}`,'--remote-debugging-port=0','--autoplay-policy=no-user-gesture-required','--use-fake-device-for-media-stream','--use-fake-ui-for-media-stream',`--use-file-for-fake-audio-capture=${path.join(root,'test-audio','sermon-simulado.wav')}`,'about:blank'];
const browser=spawn(chrome,args,{windowsHide:true,stdio:['ignore','ignore','pipe'],env:{...process.env,TEMP:profile,TMP:profile}});
let stderr='';browser.stderr.on('data',x=>stderr+=x.toString());
const pause=ms=>new Promise(r=>setTimeout(r,ms));
let ws,pending=new Map(),seq=0;
function call(method,params={}){
  return new Promise((resolve,reject)=>{
    const id=++seq,timer=setTimeout(()=>{pending.delete(id);reject(Error('CDP timeout '+method));},60000);
    pending.set(id,{resolve,reject,timer});ws.send(JSON.stringify({id,method,params}));
  });
}
const evaluate=async expression=>{
  const r=await call('Runtime.evaluate',{expression,awaitPromise:true,returnByValue:true,userGesture:true});
  if(r.exceptionDetails)throw Error(JSON.stringify(r.exceptionDetails));
  return r.result?.value;
};
const errors=[],results={fecha:new Date().toISOString(),fuente:'Chrome headless, micrófono simulado por WAV; no hardware real',paginas:[]};
try{
  let endpoint;
  for(let i=0;i<100;i++){
    const match=stderr.match(/DevTools listening on (ws:\/\/[^\s]+)/);
    if(match){endpoint=match[1];break;}
    if(browser.exitCode!=null)throw Error('Chrome salió: '+stderr);
    await pause(100);
  }
  if(!endpoint)throw Error('Chrome no abrió DevTools: '+stderr);
  const devtoolsPort=new URL(endpoint).port;
  const pages=await(await fetch(`http://127.0.0.1:${devtoolsPort}/json/list`)).json();
  const page=pages.find(p=>p.type==='page');ws=new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((resolve,reject)=>{ws.onopen=resolve;ws.onerror=reject;});
  ws.onmessage=e=>{
    const m=JSON.parse(e.data);
    if(m.id&&pending.has(m.id)){
      const p=pending.get(m.id);pending.delete(m.id);clearTimeout(p.timer);
      m.error?p.reject(Error(JSON.stringify(m.error))):p.resolve(m.result);
    }else if(m.method==='Runtime.exceptionThrown')errors.push(m.params);
  };
  await call('Page.enable');await call('Runtime.enable');results.navegador=await evaluate('navigator.userAgent');
  async function navigate(folder){
    await call('Page.navigate',{url:base+'/experiments/'+folder+'/'});
    for(let i=0;i<100;i++){try{if(await evaluate('!!window.lab'))return;}catch{}await pause(50);}
    throw Error('No cargó '+folder);
  }
  for(const folder of ['a-captura','b-energia','c-velocidad','d-pitch','e-motor','f-sonido','g-retro']){
    await navigate(folder);await evaluate('window.lab.startFixture()');await pause(900);
    const metrics=await evaluate('window.lab.getMetrics()');
    if(!metrics.worklet_mensajes)throw Error(folder+': Worklet no recibió audio');
    results.paginas.push({carpeta:folder,...metrics});
    const shot=await call('Page.captureScreenshot',{format:'png',captureBeyondViewport:false});
    fs.writeFileSync(path.join(dir,folder,'captura.png'),Buffer.from(shot.data,'base64'));
    await evaluate('window.lab.stop()');
  }
  await navigate('a-captura');const captures=[];
  for(const on of [false,true]){
    await evaluate(`window.lab.startMic(${on})`);await pause(1100);
    captures.push({constraints_solicitados:on,...await evaluate('window.lab.getMetrics()')});
    await evaluate('window.lab.stop()');
  }
  fs.writeFileSync(path.join(dir,'a-captura','navegador.json'),JSON.stringify({fuente:results.fuente,capturas:captures},null,2)+'\n');
  await navigate('e-motor');const clocks=[];
  for(const mode of ['propio','tone']){
    try{clocks.push(await evaluate(`window.lab.runJitter('${mode}')`));}
    catch(e){clocks.push({metodo:mode,estado:'no medido',error:e.message});}
  }
  fs.writeFileSync(path.join(dir,'e-motor','navegador.json'),JSON.stringify({navegador:results.navegador,comparacion:clocks},null,2)+'\n');
  await navigate('f-sonido');const loops=[];
  for(const key of ['Do','Sol']){
    const r=await evaluate(`window.lab.render('${key}')`);
    fs.writeFileSync(path.join(dir,'f-sonido',`loop-${key.toLowerCase()}.wav`),Buffer.from(r.wav));loops.push(r.metrics);
  }
  fs.writeFileSync(path.join(dir,'f-sonido','navegador.json'),JSON.stringify({navegador:results.navegador,render:loops},null,2)+'\n');
  results.errores_js=errors;
  if(errors.length)throw Error('Errores JavaScript: '+JSON.stringify(errors));
  console.log(JSON.stringify({paginas_ok:results.paginas.length,captura:captures,motor:clocks,loops},null,2));
}catch(e){results.error=e.stack;console.error(e.stack);process.exitCode=1;}
finally{
  fs.writeFileSync(path.join(dir,'navegador-resultados.json'),JSON.stringify(results,null,2)+'\n');
  ws?.close();for(const p of pending.values()){clearTimeout(p.timer);p.reject(Error('CDP cerrado'));}pending.clear();
  browser.kill();await new Promise(resolve=>server.close(resolve));
}
