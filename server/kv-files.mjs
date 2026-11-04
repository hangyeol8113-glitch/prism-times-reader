export const FILE_CHUNK_BYTES=4*1024*1024;
export const chunkKey=(key,index)=>`${key}/part-${index}`;

// Versions become readable only after every immutable part is acknowledged in D1.
export function kvFiles(env){return {
 async get(key,{range}={}){
  const v=await env.DB.prepare("SELECT size,id FROM prism_versions WHERE object_key=? AND status='ready'").bind(key).first();
  if(!v)return null;
  const start=range?.offset??0,end=start+(range?.length??v.size);
  let index=Math.floor(start/FILE_CHUNK_BYTES);
  const last=Math.floor((end-1)/FILE_CHUNK_BYTES);
  const first=await env.PDF_STORAGE.get(chunkKey(key,index),'arrayBuffer');
  if(!first)throw Error('PDF 저장 내용이 아직 전파 중입니다. 잠시 후 다시 열어 주세요.');
  let next=first;
  return {httpEtag:`"${v.id}"`,body:new ReadableStream({
   async pull(controller){try{
    const bytes=new Uint8Array(next??await env.PDF_STORAGE.get(chunkKey(key,index),'arrayBuffer'));
    const offset=index*FILE_CHUNK_BYTES;
    if(bytes.byteLength!==Math.min(FILE_CHUNK_BYTES,v.size-offset))throw Error('PDF 조각을 읽지 못했습니다. 잠시 후 다시 열어 주세요.');
    controller.enqueue(bytes.subarray(Math.max(0,start-offset),Math.min(bytes.length,end-offset)));
    next=null;if(index++===last)controller.close();
   }catch(e){controller.error(e);}}
  })};
 },
 async delete(key){
  const v=await env.DB.prepare('SELECT size FROM prism_versions WHERE object_key=?').bind(key).first();
  if(v)for(let i=0;i<Math.ceil(v.size/FILE_CHUNK_BYTES);i++)await env.PDF_STORAGE.delete(chunkKey(key,i));
 },
 async put(){throw Error('이 서버에서는 분할 업로드를 사용해 주세요. 관리실을 새로고침해 주세요.');}
};}

export async function handleChunkUpload(request,env,path){
 const match=/^admin\/uploads\/([a-zA-Z0-9-]+)\/(chunks\/(\d+)|complete)$/.exec(path);
 if(!match||!env.PDF_STORAGE)return null;
 const db=env.DB,id=match[1],v=await db.prepare("SELECT v.* FROM prism_versions v JOIN prism_editions e ON e.id=v.edition_id WHERE v.id=? AND e.deleted_at IS NULL").bind(id).first();
 const reply=(data,status=200)=>new Response(JSON.stringify(data),{status,headers:{'Content-Type':'application/json','Cache-Control':'no-store'}});
 if(!v)return reply({error:'업로드할 신문을 찾을 수 없습니다.'},404);
 if(match[2]==='complete'&&request.method==='POST'){
  if(v.status==='ready')return reply({ok:true,id});
  if(v.status!=='uploading')return reply({error:'업로드 상태를 확인해 주세요.'},409);
  const expected=Math.ceil(v.size/FILE_CHUNK_BYTES);
  const rows=(await db.prepare("SELECT part,size FROM prism_upload_parts WHERE version_id=? AND status='stored' ORDER BY part").bind(id).all()).results;
  if(rows.length!==expected||rows.some((r,i)=>r.part!==i||r.size!==Math.min(FILE_CHUNK_BYTES,v.size-i*FILE_CHUNK_BYTES)))return reply({error:'일부 PDF 전송이 끝나지 않았습니다. 다시 시도해 주세요.'},409);
  const time=new Date().toISOString();
  const result=await db.batch([
   db.prepare("UPDATE prism_versions SET status='ready' WHERE id=? AND status='uploading' AND EXISTS(SELECT 1 FROM prism_editions WHERE id=prism_versions.edition_id AND deleted_at IS NULL) RETURNING id").bind(id),
   db.prepare("UPDATE prism_editions SET pending_version=?,updated_at=? WHERE id=? AND deleted_at IS NULL AND EXISTS(SELECT 1 FROM prism_versions WHERE id=? AND status='ready')").bind(id,time,v.edition_id,id)
  ]);
  if(!result[0].results.length)return reply({error:'신문 상태가 변경됐습니다.'},409);
  await db.prepare('INSERT INTO prism_audit (id,action,edition_id,detail,created_at) VALUES (?,?,?,?,?)').bind(crypto.randomUUID(),'upload',v.edition_id,`${v.filename} · ${v.page_count}쪽 저장`,time).run();
  return reply({ok:true,id});
 }
 if(!match[3]||request.method!=='PUT')return reply({error:'지원하지 않는 요청입니다.'},405);
 if(v.status!=='uploading')return reply({error:'이미 마감된 PDF입니다.'},409);
 const index=Number(match[3]),length=Math.min(FILE_CHUNK_BYTES,v.size-index*FILE_CHUNK_BYTES);
 if(!Number.isInteger(index)||index<0||length<=0)return reply({error:'올바르지 않은 PDF 조각입니다.'},400);
 const contentLength=Number(request.headers.get('Content-Length'));
 if(contentLength&&contentLength!==length)return reply({error:'파일 크기가 맞지 않습니다.'},400);
 const reader=request.body?.getReader();if(!reader)return reply({error:'PDF 내용이 없습니다.'},400);
 const bytes=new Uint8Array(length);let offset=0;
 while(true){const {done,value}=await reader.read();if(done)break;if(offset+value.length>length){await reader.cancel();return reply({error:'파일 크기가 맞지 않습니다.'},400);}bytes.set(value,offset);offset+=value.length;}
 if(offset!==length)return reply({error:'파일 전송이 완료되지 않았습니다.'},400);
 if(index===0&&!new TextDecoder().decode(bytes.subarray(0,1024)).includes('%PDF-'))return reply({error:'PDF 형식을 확인해 주세요.'},400);
 const claimed=await db.prepare("INSERT INTO prism_upload_parts (version_id,part,size,status) VALUES (?,?,?,'receiving') ON CONFLICT(version_id,part) DO UPDATE SET status='receiving' WHERE prism_upload_parts.status='failed' RETURNING part").bind(id,index,length).first();
 if(!claimed){const old=await db.prepare('SELECT status FROM prism_upload_parts WHERE version_id=? AND part=?').bind(id,index).first();return old?.status==='stored'?reply({ok:true,index}):reply({error:'같은 조각을 저장 중입니다. 잠시 후 다시 시도해 주세요.'},409);}
 try{await env.PDF_STORAGE.put(chunkKey(v.object_key,index),bytes);await db.prepare("UPDATE prism_upload_parts SET status='stored' WHERE version_id=? AND part=?").bind(id,index).run();return reply({ok:true,index});}
 catch(e){await db.prepare("UPDATE prism_upload_parts SET status='failed' WHERE version_id=? AND part=?").bind(id,index).run();throw e;}
}
