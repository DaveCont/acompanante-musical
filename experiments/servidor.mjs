// HTTP por defecto; HTTPS opcional con certificado propio, sin escrituras externas.
import http from 'node:http';import https from 'node:https';import fs from 'node:fs';import path from 'node:path';import os from 'node:os';import {fileURLToPath} from 'node:url';
const root=fileURLToPath(new URL('../',import.meta.url)),port=Number(process.env.PORT??8080);
const mime={'.html':'text/html; charset=utf-8','.mjs':'text/javascript; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.json':'application/json; charset=utf-8','.wav':'audio/wav','.md':'text/plain; charset=utf-8'};
export function createServer(){const handler=(req,res)=>{try{
  const pathname=decodeURIComponent(new URL(req.url,'http://localhost').pathname),file=path.resolve(root,'.'+pathname);
  if(!file.startsWith(root)||pathname.includes('/.git')||pathname.includes('/node_modules')||pathname.includes('/.cache')||pathname.includes('/.browser')){res.writeHead(403);res.end('No permitido');return;}
  let target=file;if(fs.existsSync(target)&&fs.statSync(target).isDirectory())target=path.join(target,'index.html');
  if(!fs.existsSync(target)||!fs.statSync(target).isFile()){res.writeHead(404);res.end('No encontrado');return;}
  res.writeHead(200,{'Content-Type':mime[path.extname(target)]??'application/octet-stream','Cache-Control':'no-store'});fs.createReadStream(target).pipe(res);
}catch(e){res.writeHead(400);res.end(e.message);}};
  return process.env.TLS_CERT&&process.env.TLS_KEY?https.createServer({cert:fs.readFileSync(process.env.TLS_CERT),key:fs.readFileSync(process.env.TLS_KEY)},handler):http.createServer(handler);
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  const server=createServer();server.listen(port,'0.0.0.0',()=>{const protocol=process.env.TLS_CERT?'https':'http';console.log(`${protocol}://localhost:${port}/experiments/`);for(const addresses of Object.values(os.networkInterfaces()))for(const a of addresses??[])if(a.family==='IPv4'&&!a.internal)console.log(`Tablet WAV: ${protocol}://${a.address}:${port}/experiments/`);});
}
