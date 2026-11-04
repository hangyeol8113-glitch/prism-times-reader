const hex=b=>Array.from(new Uint8Array(b),x=>x.toString(16).padStart(2,'0')).join('');
export const SESSION_SECONDS=43200;
export const COOKIE_NAME='prism_admin_session';
export function randomToken(){return hex(crypto.getRandomValues(new Uint8Array(32)));}
export async function digest(text){return hex(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(text)));}
export async function hashPassword(password){
 const salt=crypto.getRandomValues(new Uint8Array(16));
 const key=await crypto.subtle.importKey('raw',new TextEncoder().encode(password),'PBKDF2',false,['deriveBits']);
 const bits=await crypto.subtle.deriveBits({name:'PBKDF2',salt,iterations:100000,hash:'SHA-256'},key,256);
 return `pbkdf2_sha256$100000$${hex(salt)}$${hex(bits)}`;
}
export async function verifyPassword(password,encoded){
 if(typeof password!=='string'||password.length>200||!/^pbkdf2_sha256\$\d+\$[a-f0-9]{32}\$[a-f0-9]{64}$/.test(encoded||''))return false;
 const [,iterations,salt,expected]=encoded.split('$');const count=Number(iterations);if(count<10000||count>100000)return false;
 const key=await crypto.subtle.importKey('raw',new TextEncoder().encode(password),'PBKDF2',false,['deriveBits']);
 const actual=hex(await crypto.subtle.deriveBits({name:'PBKDF2',salt:new Uint8Array(salt.match(/../g).map(x=>parseInt(x,16))),iterations:count,hash:'SHA-256'},key,256));
 let diff=0;for(let i=0;i<expected.length;i++)diff|=expected.charCodeAt(i)^actual.charCodeAt(i);return diff===0;
}
export function sessionToken(request){const value=request.headers.get('Cookie')?.split(';').map(x=>x.trim()).find(x=>x.startsWith(COOKIE_NAME+'='))?.slice(COOKIE_NAME.length+1);return /^[a-f0-9]{64}$/.test(value||'')?value:null;}
export function sessionCookie(token,request,seconds=SESSION_SECONDS){return `${COOKIE_NAME}=${token}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${seconds}${new URL(request.url).protocol==='https:'?'; Secure':''}`;}
export function validMutation(request){return request.headers.get('Origin')===new URL(request.url).origin&&request.headers.get('X-Prism-Admin')==='1';}
