import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFile,readdir} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import worker from '../dist/worker.js';
import {hashPassword} from '../server/auth.mjs';
const sql=new DatabaseSync(':memory:');
for(const name of (await readdir(new URL('../migrations/',import.meta.url))).filter(n=>n.endsWith('.sql')).sort())sql.exec(await readFile(new URL('../migrations/'+name,import.meta.url),'utf8'));
const statement=(query,args=[])=>({query,args,bind(...values){return statement(query,values);},async first(){return sql.prepare(query).get(...args)??null;},async all(){return {results:sql.prepare(query).all(...args)};},async run(){sql.prepare(query).run(...args);return {success:true};}});
const db={prepare:statement,async batch(items){sql.exec('BEGIN');try{const result=items.map(s=>({results:/RETURNING/i.test(s.query)?sql.prepare(s.query).all(...s.args):(sql.prepare(s.query).run(...s.args),[])}));sql.exec('COMMIT');return result;}catch(e){sql.exec('ROLLBACK');throw e;}}};
const values=new Map();
const env={DB:db,PDF_STORAGE:{async put(k,v){values.set(k,new Uint8Array(v).slice());},async get(k){return values.get(k)?.slice().buffer??null;},async delete(k){values.delete(k);}},ADMIN_PASSWORD_HASH:await hashPassword('qa-only-password'),EMPTY_START:'true',READER_URL:'https://reader.example/prism/',ASSETS:{fetch:async()=>new Response('asset')}};
const origin='https://worker.example';let cookie='';
async function request(path,{method='GET',data,bytes,auth=true,csrf=true,headers={}}={}){const h={...headers};if(auth&&cookie)h.Cookie=cookie;if(method!=='GET'&&csrf){h.Origin=origin;h['X-Prism-Admin']='1';}if(data)h['Content-Type']='application/json';if(bytes)h['Content-Type']='application/pdf';return worker.fetch(new Request(origin+path,{method,headers:h,body:bytes??(data?JSON.stringify(data):undefined),duplex:'half'}),env);}
const api=p=>'/api/prism/'+p;
try{
 assert.equal((await request(api('admin/editions'))).status,401);
 assert.equal((await request(api('login'),{method:'POST',data:{password:'qa-only-password'},csrf:false})).status,403);
 const login=await request(api('login'),{method:'POST',data:{password:'qa-only-password'}});assert.equal(login.status,200);cookie=login.headers.get('set-cookie').split(';')[0];
 const edition={id:'2026-01',year:2026,title:'한국어 신문',label:'2026 · 한국어판',language:'ko'};
 let r=await request(api('admin/editions'),{method:'POST',data:edition});assert.equal(r.status,201,await r.text());
 const pdf=process.argv[2]?new Uint8Array(await readFile(process.argv[2])):new Uint8Array(9*1024*1024+321).fill(65);if(!process.argv[2])pdf.set(new TextEncoder().encode('%PDF-1.7\n'));
 r=await request(api('admin/uploads'),{method:'POST',data:{editionId:'2026-01',filename:'신문.pdf',size:pdf.length,pageCount:16}});assert.equal(r.status,201);const reservation=await r.json();assert.equal(reservation.chunkSize,4*1024*1024);
 assert.equal((await request(reservation.url+'/chunks/0',{method:'PUT',bytes:pdf.slice(0,reservation.chunkSize),auth:false})).status,401);
 for(let i=0;i<Math.ceil(pdf.length/reservation.chunkSize);i++){r=await request(reservation.url+'/chunks/'+i,{method:'PUT',bytes:pdf.slice(i*reservation.chunkSize,(i+1)*reservation.chunkSize)});assert.equal(r.status,200,await r.text());}
 r=await request(reservation.url+'/complete',{method:'POST',data:{}});assert.equal(r.status,200,await r.text());
 assert.equal((await request(api('files/'+reservation.id),{auth:false})).status,401);
 r=await request(api('admin/publish'),{method:'POST',data:{editionId:'2026-01',versionId:reservation.id,makeDefault:true}});assert.equal(r.status,200,await r.text());
 r=await request('/editions.json',{auth:false});assert.equal(r.headers.get('access-control-allow-origin'),'*');const config=await r.json();assert.equal(config.defaultIssue,'2026-01');assert.equal(config.editions.find(e=>e.id==='2026-01').pdf,origin+api('files/'+reservation.id));
 r=await request(api('files/'+reservation.id),{auth:false});assert.equal(r.status,200);const actual=new Uint8Array(await r.arrayBuffer());assert.equal(createHash('sha256').update(actual).digest('hex'),createHash('sha256').update(pdf).digest('hex'));
 r=await request(api('files/'+reservation.id),{auth:false,headers:{Range:'bytes=4194300-4194310'}});assert.equal(r.status,206);assert.deepEqual(new Uint8Array(await r.arrayBuffer()),pdf.slice(4194300,4194311));
 r=await request(api('admin/editions/2026-01/trash'),{method:'POST',data:{}});assert.equal(r.status,200,await r.text());assert.equal((await request(api('files/'+reservation.id),{auth:false})).status,410);
 r=await request(api('admin/editions/2026-01/restore'),{method:'POST',data:{}});assert.equal(r.status,200,await r.text());assert.equal((await request(api('files/'+reservation.id),{auth:false})).status,200);
 r=await request(api('admin/qr')+'?issue=2026-01&page=4');assert.equal(r.status,200);assert.match(await r.text(),/<svg/);
 r=await request(api('admin/backup'));assert.equal(r.status,200);assert.equal((await r.json()).versions.find(v=>v.id===reservation.id).size,pdf.length);
 console.log('PASS: full KV Worker API, auth/CSRF, '+pdf.length+' bytes upload/hash/ranges, draft privacy, publish, trash/restore, QR and backup metadata (SQLite/KV test adapters).');
}finally{sql.close();}
