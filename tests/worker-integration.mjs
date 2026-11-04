import assert from 'node:assert/strict';
import {readFile,readdir,mkdtemp,mkdir,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createRequire} from 'node:module';
import {prepareRestore} from '../scripts/prepare-restore.mjs';
const require=createRequire(new URL('../node_modules/wrangler/package.json',import.meta.url));const {Miniflare}=require('miniflare');
const script=await readFile(new URL('../dist/worker.js',import.meta.url),'utf8');assert.ok(!script.includes('cloudflare:workers'));assert.ok(!script.includes('CUSTOMER_HTTP_'));assert.ok(!script.includes('OAI-Sites-Authorization'));
const mf=new Miniflare({modules:true,script,compatibilityDate:'2026-05-15',d1Databases:['DB'],r2Buckets:['BUCKET'],serviceBindings:{ASSETS:async r=>new Response(new URL(r.url).pathname==='/style.css'?'body{}':'Missing asset',{status:new URL(r.url).pathname==='/style.css'?200:404})}});
const folder=await mkdtemp(join(tmpdir(),'prism-restore-'));
try{
 const db=await mf.getD1Database('DB');for(const filename of (await readdir(new URL('../migrations/',import.meta.url))).filter(f=>f.endsWith('.sql')).sort()){const source=await readFile(new URL('../migrations/'+filename,import.meta.url),'utf8');for(const sql of source.split('--> statement-breakpoint').map(s=>s.trim()).filter(Boolean))await db.prepare(sql).run();}
 let r=await mf.dispatchFetch('https://prism.example/?issue=2026-02-english-sample&page=4');assert.equal(r.status,200);assert.ok((await r.text()).includes('id="book"'));
 r=await mf.dispatchFetch('https://prism.example/admin');assert.equal(r.status,200);assert.ok(r.headers.get('content-security-policy').includes("default-src 'self'"));assert.ok((await r.text()).includes('id="delete-form"'));
 r=await mf.dispatchFetch('https://prism.example/editions.json');const config=await r.json();assert.equal(config.defaultIssue,'2026-02-english-sample');assert.equal(config.editions.length,2);
 assert.equal((await (await mf.dispatchFetch('https://prism.example/api/prism/session')).json()).authenticated,false);assert.equal((await mf.dispatchFetch('https://prism.example/api/prism/admin/editions')).status,401);
 r=await mf.dispatchFetch('https://prism.example/index.html?issue=2026-preview&page=4',{redirect:'manual'});assert.equal(new URL(r.headers.get('location')).search,'?issue=2026-preview&page=4');
 assert.equal((await mf.dispatchFetch('https://prism.example/style.css')).status,200);assert.equal((await mf.dispatchFetch('https://prism.example/missing')).status,404);assert.equal((await mf.dispatchFetch('https://prism.example/admin',{method:'POST'})).status,405);
 // Data restoration preserves default selection and tombstones without copying authentication.
 const t='2026-11-03T00:00:00.000Z';const editions=[{id:'2030-01',year:2030,title:"Editor's paper",label:'2030',language:'ko',is_demo:0,sections:'[]',current_version:'revision-1',pending_version:null,published:1,deleted_at:null,created_at:t,updated_at:t},{id:'2029-01',year:2029,title:'Archive',label:'2029',language:'ko',is_demo:0,sections:'[]',current_version:'revision-2',pending_version:null,published:1,deleted_at:t,created_at:t,updated_at:t}];
 const bytes=Buffer.from('%PDF-1.7\nfixture');const versions=editions.map((e,i)=>({id:'revision-'+(i+1),edition_id:e.id,filename:'paper.pdf',size:bytes.length,page_count:16,created_at:t,published_at:t}));
 for(const v of versions){await mkdir(join(folder,'reader','papers',v.edition_id),{recursive:true});await writeFile(join(folder,'reader','papers',v.edition_id,v.id+'.pdf'),bytes);}
 await writeFile(join(folder,'management-data.json'),JSON.stringify({schemaVersion:1,origin:'https://old.example',defaultIssue:'2030-01',editions,versions,audit:[]}));
 const plan=await prepareRestore(folder,join(folder,'out'));assert.equal(plan.versionCount,2);const sql=await readFile(join(folder,'out','data.sql'),'utf8');assert.ok(!sql.includes('prism_sessions'));assert.ok(!sql.includes("'auth'"));for(const q of sql.split('\n').filter(Boolean))await db.prepare(q).run();
 assert.equal((await db.prepare('SELECT title FROM prism_editions WHERE id=?').bind('2030-01').first()).title,"Editor's paper");assert.equal((await db.prepare('SELECT deleted_at FROM prism_editions WHERE id=?').bind('2029-01').first()).deleted_at,t);assert.equal((await db.prepare("SELECT value FROM prism_settings WHERE key='defaultIssue'").first()).value,'2030-01');
 console.log('PASS: independent Worker routing, server authentication boundary, static assets, and data restore including deleted editions and default selection.');
}finally{await mf.dispose();await rm(folder,{recursive:true,force:true});}
