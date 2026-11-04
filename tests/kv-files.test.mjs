import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFile,readdir} from 'node:fs/promises';
import {kvFiles,handleChunkUpload,chunkKey,FILE_CHUNK_BYTES} from '../server/kv-files.mjs';

function fixture(size=FILE_CHUNK_BYTES+27){
 const sql=new DatabaseSync(':memory:');
 const wrap=query=>({bind(...args){return statement(query,args);},...statement(query,[])});
 const statement=(q,args)=>({bind(...values){return statement(q,values);},async first(){return sql.prepare(q).get(...args)||null;},async all(){return {results:sql.prepare(q).all(...args)};},async run(){sql.prepare(q).run(...args);return {success:true};},_query:q,_args:args});
 const db={prepare:wrap,async batch(items){sql.exec('BEGIN');try{const result=items.map(s=>({results:/RETURNING/i.test(s._query)?sql.prepare(s._query).all(...s._args):(sql.prepare(s._query).run(...s._args),[])}));sql.exec('COMMIT');return result;}catch(e){sql.exec('ROLLBACK');throw e;}}};
 const values=new Map();const env={DB:db,PDF_STORAGE:{async put(k,v){values.set(k,new Uint8Array(v).slice());},async get(k){return values.get(k)?.slice().buffer??null;},async delete(k){values.delete(k);}}};
 return {sql,env,values,size};
}
async function setup(size){const f=fixture(size);for(const file of (await readdir(new URL('../migrations/',import.meta.url))).filter(n=>n.endsWith('.sql')).sort())f.sql.exec(await readFile(new URL('../migrations/'+file,import.meta.url),'utf8'));f.sql.prepare("INSERT INTO prism_editions (id,year,title,label,created_at,updated_at) VALUES ('2026-01',2026,'신문','한국어판','now','now')").run();f.sql.prepare("INSERT INTO prism_versions (id,edition_id,object_key,filename,size,page_count,status,created_at) VALUES ('version-1','2026-01','papers/v1','paper.pdf',?,16,'uploading','now')").run(f.size);return f;}
const req=(body,method='PUT')=>new Request('https://test.invalid/api/prism/admin/uploads/version-1',{method,body,duplex:'half'});
test('chunk upload, completion, immutable retry and range read across part boundary',async()=>{
 const f=await setup();
 try{
  let r=await handleChunkUpload(req('{}','POST'),f.env,'admin/uploads/version-1/complete');assert.equal(r.status,409);
  const a=new Uint8Array(FILE_CHUNK_BYTES).fill(65);a.set(new TextEncoder().encode('%PDF-1.7\n'));const b=new Uint8Array(27).fill(66);
  assert.equal((await handleChunkUpload(req(a),f.env,'admin/uploads/version-1/chunks/0')).status,200);
  assert.equal((await handleChunkUpload(req(a),f.env,'admin/uploads/version-1/chunks/0')).status,200);
  assert.equal((await handleChunkUpload(req(b),f.env,'admin/uploads/version-1/chunks/1')).status,200);
  assert.equal((await handleChunkUpload(req('{}','POST'),f.env,'admin/uploads/version-1/complete')).status,200);
  assert.equal(f.sql.prepare("SELECT pending_version FROM prism_editions").get().pending_version,'version-1');
  assert.equal((await handleChunkUpload(req(a),f.env,'admin/uploads/version-1/chunks/0')).status,409);
  const file=await kvFiles(f.env).get('papers/v1',{range:{offset:FILE_CHUNK_BYTES-2,length:5}});
  assert.deepEqual([...new Uint8Array(await new Response(file.body).arrayBuffer())],[65,65,66,66,66]);
  assert.equal((await new Response((await kvFiles(f.env).get('papers/v1')).body).arrayBuffer()).byteLength,f.size);
 }finally{f.sql.close();}
});
test('invalid bytes, missing parts, deleted edition and storage failure never create a ready version',async()=>{
 const f=await setup(10);try{
  assert.equal((await handleChunkUpload(req(new Uint8Array(10)),f.env,'admin/uploads/version-1/chunks/0')).status,400);
  assert.equal((await handleChunkUpload(req(new TextEncoder().encode('%PDF-12345')),f.env,'admin/uploads/version-1/chunks/2')).status,400);
  f.env.PDF_STORAGE.put=async()=>{throw Error('quota');};await assert.rejects(handleChunkUpload(req(new TextEncoder().encode('%PDF-12345')),f.env,'admin/uploads/version-1/chunks/0'),/quota/);
  assert.equal(f.sql.prepare('SELECT status FROM prism_upload_parts').get().status,'failed');
  assert.equal((await handleChunkUpload(req('{}','POST'),f.env,'admin/uploads/version-1/complete')).status,409);
  f.sql.prepare("UPDATE prism_editions SET deleted_at='now'").run();assert.equal((await handleChunkUpload(req(new TextEncoder().encode('%PDF-12345')),f.env,'admin/uploads/version-1/chunks/0')).status,404);
  assert.equal(f.sql.prepare('SELECT status FROM prism_versions').get().status,'uploading');
 }finally{f.sql.close();}
});
