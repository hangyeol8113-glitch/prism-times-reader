import reader from './reader-template.html';
import admin from './admin-template.html';
import {handleAPI,publicConfigResponse} from './server/prism-api.mjs';
const adminCSP="default-src 'self'; script-src 'self' 'wasm-unsafe-eval'; worker-src 'self' blob:; connect-src 'self'; img-src 'self' blob: data:; style-src 'self' 'unsafe-inline'; font-src 'self'; frame-src 'self'; base-uri 'self'; frame-ancestors 'self'";
export default {
 async fetch(request,env){
  const url=new URL(request.url),path=url.pathname;
  if(path.startsWith('/api/prism/'))return handleAPI(request,env);
  if(path==='/editions.json'&&request.method==='GET')return publicConfigResponse(env);
  if(path==='/studio.html'||path==='/index.html'){url.pathname=path==='/studio.html'?'/admin':'/';return Response.redirect(url,302);}
  if((path==='/'||path==='/admin'||path==='/admin/')&&['GET','HEAD'].includes(request.method)){
   const isAdmin=path!=='/';return new Response(request.method==='HEAD'?null:isAdmin?admin:reader,{headers:{'Content-Type':'text/html; charset=utf-8','Cache-Control':isAdmin?'no-store':'no-cache','X-Content-Type-Options':'nosniff','Referrer-Policy':'same-origin',...(isAdmin?{'X-Frame-Options':'SAMEORIGIN','Content-Security-Policy':adminCSP}:{})}});
  }
  if(!['GET','HEAD'].includes(request.method))return new Response('Method not allowed',{status:405,headers:{Allow:'GET, HEAD'}});
  return env.ASSETS.fetch(request);
 }
};
