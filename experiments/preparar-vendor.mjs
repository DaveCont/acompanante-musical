// npm install y luego npm run vendor. No descarga recursos durante las pruebas.
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
const root=path.dirname(fileURLToPath(import.meta.url));
fs.mkdirSync(root+'/vendor',{recursive:true});
const status={};let build;
try{({build}=await import('esbuild'));}catch{console.error('esbuild ausente: npm install requiere acceso al registro.');}
for(const [name,entry] of [['tone','tone'],['pitchy','pitchy'],['meyda','meyda']]){
  try{
    if(!build)throw Error('esbuild no instalado');
    const dest=`${root}/vendor/${name}.min.js`;
    await build({stdin:{contents:`export * from '${entry}'; import * as lib from '${entry}'; export default lib.default ?? lib;`,resolveDir:root},bundle:true,minify:true,format:'esm',platform:'browser',outfile:dest,legalComments:'eof'});
    const pkg=JSON.parse(fs.readFileSync(`${root}/node_modules/${name}/package.json`,'utf8'));
    status[name]={estado:'listo',version:pkg.version,kib:fs.statSync(dest).size/1024};
    // Conservar avisos y licencias originales junto al bundle.
    const dir=`${root}/node_modules/${name}`;
    const license=fs.readdirSync(dir).find(n=>/^licen[cs]e/i.test(n));
    if(license)fs.copyFileSync(path.join(dir,license),`${root}/vendor/${name}.LICENSE`);
  }catch(e){status[name]={estado:'pendiente',motivo:e.message};console.error(name,e.message);}
}
fs.writeFileSync(root+'/vendor/estado.json',JSON.stringify(status,null,2)+'\n');
if(Object.values(status).some(v=>v.estado!=='listo'))process.exitCode=2;
