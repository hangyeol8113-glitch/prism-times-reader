import {unzipSync,strFromU8} from 'fflate';
// Runs against an isolated workerd/D1/R2 test instance, never production.
import assert from 'node:assert/strict';
import {readFile,readdir} from 'node:fs/promises';
import {createRequire} from 'node:module';
import {hashPassword} from '../server/auth.mjs';
const require=createRequire(new URL('../node_modules/wrangler/package.json',import.meta.url));
const {Miniflare}=require('miniflare');
const {build}=require('esbuild');
const compiled=await build({stdin:{contents:"import {handleAPI,publicConfigResponse} from './server/prism-api.mjs'; export default {fetch(r,e){return new URL(r.url).pathname==='/editions.json'?publicConfigResponse(e):handleAPI(r,e);}}",resolveDir:process.cwd()},bundle:true,format:'esm',platform:'browser',write:false});
const mf=new Miniflare({modules:true,script:compiled.outputFiles[0].text,compatibilityDate:'2026-05-15',d1Databases:['DB'],r2Buckets:['BUCKET'],bindings:{ADMIN_PASSWORD_HASH:await hashPassword('local-test-original')}});
const db=await mf.getD1Database('DB');
for(const filename of (await readdir(new URL('../migrations/',import.meta.url))).filter(f=>f.endsWith('.sql')).sort()){
 const schema=await readFile(new URL('../migrations/'+filename,import.meta.url),'utf8');
 for(const sql of schema.split('--> statement-breakpoint').map(s=>s.trim()).filter(Boolean))await db.prepare(sql).run();
}
const fetch=(input,options)=>mf.dispatchFetch(input,options);
try {
const base='http://127.0.0.1:4173';
let cookie='';
async function req(path,{method='GET',data,raw,auth=true,csrf=true}={}){const headers={};if(auth&&cookie)headers.Cookie=cookie;if(method!=='GET'&&csrf){headers.Origin=base;headers['X-Prism-Admin']='1';}if(data)headers['Content-Type']='application/json';if(raw)headers['Content-Type']='application/pdf';const r=await fetch(base+path,{method,headers,body:raw||data&&JSON.stringify(data),redirect:'manual'});return r;}
async function ok(path,options={}){const r=await req(path,options);assert.ok(r.ok,`${path}: ${r.status} ${!r.ok?await r.text():''}`);return r.json();}
const api=p=>'/api/prism/'+p;
assert.equal((await req(api('admin/editions'))).status,401);
assert.equal((await req(api('login'),{method:'POST',data:{password:'wrong'},csrf:false})).status,403);
assert.equal((await req(api('login'),{method:'POST',data:{password:'wrong'}})).status,401);
let login=await req(api('login'),{method:'POST',data:{password:'local-test-original'}});assert.equal(login.status,200);cookie=login.headers.get('set-cookie').split(';')[0];assert.match(login.headers.get('set-cookie'),/HttpOnly/);assert.match(login.headers.get('set-cookie'),/SameSite=Strict/);
assert.equal((await ok(api('session'))).authenticated,true);
assert.equal((await req(api('admin/editions'),{method:'POST',data:{},auth:false})).status,401);
const initial=await ok('/editions.json');const old=initial.defaultIssue;
const id='2027-qa-'+Date.now();
await ok(api('admin/editions'),{method:'POST',data:{id,year:2027,title:'LOCAL QA',label:'2027 local test',language:'ko'}});
const pdf=await readFile(new URL('../public/papers/prism-preview.pdf',import.meta.url));
async function upload(){const v=await ok(api('admin/uploads'),{method:'POST',data:{editionId:id,filename:'qa.pdf',size:pdf.length,pageCount:16}});await ok(v.url,{method:'PUT',raw:pdf});return v.id;}
const v1=await upload();
assert.equal((await req(api('files/'+v1),{auth:false})).status,401);
assert.equal((await ok(api('admin/preview/'+v1))).pageCount,16);
assert.ok(!(await ok('/editions.json')).editions.some(e=>e.id===id));
await ok(api('admin/publish'),{method:'POST',data:{editionId:id,versionId:v1,makeDefault:true}});
let config=await ok('/editions.json');assert.equal(config.defaultIssue,id);assert.ok(config.editions.some(e=>e.id===old));
let file=await req(api('files/'+v1),{auth:false});assert.equal(file.status,200);assert.equal((await file.arrayBuffer()).byteLength,pdf.length);
file=await fetch(base+api('files/'+v1),{headers:{Range:'bytes=0-99'}});assert.equal(file.status,206);assert.equal((await file.arrayBuffer()).byteLength,100);assert.equal(file.headers.get('content-range'),'bytes 0-99/'+pdf.length);
file=await fetch(base+api('files/'+v1),{headers:{Range:'bytes=-10'}});assert.equal(file.status,206);assert.equal((await file.arrayBuffer()).byteLength,10);
assert.equal((await fetch(base+api('files/'+v1),{headers:{Range:'bytes=999999999-'}})).status,416);
const v2=await upload();assert.equal((await ok('/editions.json')).editions.find(e=>e.id===id).pdf,api('files/'+v1));
await ok(api('admin/publish'),{method:'POST',data:{editionId:id,versionId:v2,makeDefault:false}});
assert.equal((await ok('/editions.json')).editions.find(e=>e.id===id).pdf,api('files/'+v2));
await ok(api('admin/publish'),{method:'POST',data:{editionId:id,versionId:v1,makeDefault:false}});
assert.equal((await ok('/editions.json')).editions.find(e=>e.id===id).pdf,api('files/'+v1));
assert.equal((await req(api('files/'+v2),{auth:false})).status,200);
const qr=await req(api('admin/qr-all')+'?issue='+id);assert.equal(qr.status,200);const zip=unzipSync(new Uint8Array(await qr.arrayBuffer()));assert.equal(Object.keys(zip).length,17);assert.ok(strFromU8(zip['links.csv']).includes('issue='+id+'&page=4'));
const backup=await ok(api('admin/backup'));assert.ok(backup.versions.some(v=>v.id===v1));assert.ok(backup.versions.some(v=>v.id===v2));assert.ok(!JSON.stringify(backup).includes('pbkdf2'));assert.ok(!JSON.stringify(backup).includes('token_hash'));
// A published edition can be withdrawn without losing any PDF revision or its QR identity.
const trashPath=api('admin/editions/'+id+'/trash'),restorePath=api('admin/editions/'+id+'/restore');
assert.equal((await req(trashPath,{method:'POST',data:{},auth:false})).status,401);
assert.equal((await req(trashPath,{method:'POST',data:{},csrf:false})).status,403);
assert.equal((await req(trashPath,{method:'POST',data:{}})).status,409);
assert.equal((await ok('/editions.json')).defaultIssue,id);
await ok(trashPath,{method:'POST',data:{replacementId:old}});
config=await ok('/editions.json');assert.equal(config.defaultIssue,old);assert.ok(config.removedIssueIds.includes(id));assert.ok(!config.editions.some(e=>e.id===id));
assert.ok(!(await ok(api('admin/editions'))).editions.some(e=>e.id===id));
assert.ok((await ok(api('admin/trash'))).editions.some(e=>e.id===id));
assert.equal((await req(api('files/'+v1),{auth:false})).status,410);
assert.equal((await req(api('files/'+v1))).status,200);
assert.equal((await req(api('files/'+v1))).headers.get('cache-control'),'private, no-store');
assert.equal((await req(api('admin/publish'),{method:'POST',data:{editionId:id,versionId:v1,makeDefault:true}})).status,400);
assert.equal((await req(api('admin/default'),{method:'POST',data:{editionId:id}})).status,400);
assert.equal((await req(api('admin/uploads'),{method:'POST',data:{editionId:id,filename:'qa.pdf',size:pdf.length,pageCount:16}})).status,400);
assert.equal((await req(api('admin/qr')+'?issue='+id+'&page=4')).status,400);
assert.equal((await req(api('admin/editions'),{method:'POST',data:{id,year:2027,title:'duplicate',label:'duplicate'}})).status,409);
const trashBackup=await ok(api('admin/backup'));assert.ok(trashBackup.editions.find(e=>e.id===id).deleted_at);assert.ok(trashBackup.versions.some(v=>v.id===v1)&&trashBackup.versions.some(v=>v.id===v2));
await ok(restorePath,{method:'POST',data:{}});config=await ok('/editions.json');assert.equal(config.defaultIssue,old);assert.equal(config.editions.find(e=>e.id===id).pdf,api('files/'+v1));assert.ok(!config.removedIssueIds.includes(id));assert.equal((await req(api('files/'+v1),{auth:false})).status,200);
// Removing the final published edition produces a proper empty reader; restoring it restores the default.
for(const edition of config.editions.filter(e=>e.id!==old))await ok(api('admin/editions/'+edition.id+'/trash'),{method:'POST',data:{}});
await ok(api('admin/editions/'+old+'/trash'),{method:'POST',data:{}});
config=await ok('/editions.json');assert.equal(config.defaultIssue,'');assert.equal(config.editions.length,0);assert.ok(config.removedIssueIds.includes(old));
await ok(api('admin/editions/'+old+'/restore'),{method:'POST',data:{}});assert.equal((await ok('/editions.json')).defaultIssue,old);
const draftId=id+'-draft';await ok(api('admin/editions'),{method:'POST',data:{id:draftId,year:2027,title:'draft',label:'draft'}});await ok(api('admin/editions/'+draftId+'/trash'),{method:'POST',data:{}});await ok(api('admin/editions/'+draftId+'/restore'),{method:'POST',data:{}});assert.ok(!(await ok('/editions.json')).editions.some(e=>e.id===draftId));
const oldCookie=cookie;const changed=await req(api('admin/password'),{method:'POST',data:{current:'local-test-original',next:'local-test-change-2027'}});assert.equal(changed.status,200);cookie=oldCookie;assert.equal((await ok(api('session'))).authenticated,false);cookie=changed.headers.get('set-cookie').split(';')[0];
const reset=await req(api('admin/password'),{method:'POST',data:{current:'local-test-change-2027',next:'local-test-original'}});assert.equal(reset.status,200);cookie=reset.headers.get('set-cookie').split(';')[0];
await ok(api('admin/default'),{method:'POST',data:{editionId:old}});
await ok(api('logout'),{method:'POST',data:{}});assert.equal((await ok(api('session'))).authenticated,false);
console.log('PASS: server login/CSRF/session revocation, draft/upload, publish/default, 2026 retention, version rollback, PDF ranges, QR ZIP, full backup metadata, soft delete/restore, deleted QR states, replacement defaults, final-edition removal and draft restoration.');
console.log('Local-only QA edition: '+id);

}finally{await mf.dispose();}
