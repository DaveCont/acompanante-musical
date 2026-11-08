import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {chromium} from 'playwright';
import {createServer} from '../servidor.mjs';
import {audio} from '../shared/node.mjs';
import {methods,calibrate,energyTrace,winnerId} from './energia.mjs';
const dir=path.dirname(fileURLToPath(import.meta.url)),profile=path.join(dir,'.browser-prueba');
fs.mkdirSync(profile,{recursive:true});
const server=createServer();await new Promise(r=>server.listen(0,'127.0.0.1',r));
let browser;
try{
  browser=await chromium.launchPersistentContext(profile,{executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true,viewport:{width:1200,height:850},env:{...process.env,TEMP:profile,TMP:profile},args:['--autoplay-policy=no-user-gesture-required','--disable-background-networking','--disable-component-update']});
  const page=await browser.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.goto(`http://127.0.0.1:${server.address().port}/experiments/b-energia/`);
  await page.evaluate(()=>window.lab.ready);
  assert.equal(await page.locator('#method').inputValue(),winnerId);
  assert.equal(await page.locator('#method option').count(),methods.length);
  const parity=[];
  for(const name of ['sermon-simulado.wav','sermon-con-musica.wav']){
    const browserResult=await page.evaluate(async name=>{
      const {calibrate,energyTrace,winnerId}=await import('./energia.mjs'),{decodeWav}=await import('../shared/wav.mjs');
      const read=async n=>decodeWav(await(await fetch('../../test-audio/'+n)).arrayBuffer()).samples;
      const config=calibrate(await read('calibracion.wav'),winnerId),t=energyTrace(await read(name),winnerId,config);
      return {config,levels:t.map(f=>f.level)};
    },name);
    const config=calibrate(audio('calibracion.wav').samples,winnerId),expected=energyTrace(audio(name).samples,winnerId,config).map(f=>f.level);
    assert.deepEqual(browserResult.config,config);assert.deepEqual(browserResult.levels,expected);parity.push({audio:name,bloques_identicos:expected.length});
  }
  await page.evaluate(()=>window.lab.startFixture());
  await page.waitForFunction(()=>window.lab.getMetrics().worklet_ultimo?.t>.5);
  assert.equal((await page.evaluate(()=>window.lab.getMetrics())).worklet_ultimo.bloque,128);
  for(const m of methods){
    await page.selectOption('#method',m.id);await page.waitForTimeout(100);
    assert.equal(await page.locator('#status').textContent(),'WAV en reproducción para análisis.');
  }
  await page.selectOption('#method',winnerId);
  await page.click('#cal');await page.waitForFunction(()=>document.querySelector('#status').textContent==='Calibración continua de 10 s aplicada.',{},{timeout:15000});
  await page.click('#calfixture');
  await page.selectOption('#fixture','sermon-con-musica.wav');await page.click('#energy');
  await page.waitForFunction(()=>document.querySelector('#energyresult').textContent.includes('hybrid'));
  await page.evaluate(()=>window.lab.stop());
  assert.deepEqual(errors,[]);
  const result={estado:'OK',seleccion_metodos:methods.length,paridad_node_navegador:parity,worklet:'bloques 128, cambio de todos los métodos',calibracion:'PCM continuo 10 s y restauración WAV',errores:errors};
  fs.writeFileSync(path.join(dir,'navegador.json'),JSON.stringify(result,null,2)+'\n');console.log(JSON.stringify(result));
}finally{await browser?.close();await new Promise(r=>server.close(r));}
