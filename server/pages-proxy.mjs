export const BACKEND='https://prism-times-reader.hangyeol8113.workers.dev';
export async function proxy(request,send=fetch){
 const url=new URL(request.url),headers=new Headers(request.headers);
 // Only the actual same-origin browser request may pass the upstream CSRF gate.
 if(!['GET','HEAD','OPTIONS'].includes(request.method)&&headers.get('Origin')!==url.origin)return new Response('요청 출처를 확인할 수 없습니다.',{status:403});
 if(headers.get('Origin')===url.origin)headers.set('Origin',BACKEND);
 const target=new URL(url.pathname+url.search,BACKEND);
 const upstream=await send(new Request(target,new Request(request,{headers,redirect:'manual'})));
 const output=new Headers(upstream.headers),location=output.get('Location');
 if(location?.startsWith(BACKEND+'/'))output.set('Location',url.origin+location.slice(BACKEND.length));
 if(url.pathname==='/editions.json'&&upstream.ok){
  const config=await upstream.json();for(const edition of config.editions||[])if(edition.pdf?.startsWith(BACKEND+'/'))edition.pdf=url.origin+edition.pdf.slice(BACKEND.length);
  output.delete('Content-Length');output.delete('Content-Encoding');return new Response(JSON.stringify(config),{status:upstream.status,headers:output});
 }
 return new Response(upstream.body,{status:upstream.status,headers:output});
}
export default {fetch(request){return proxy(request);}};
