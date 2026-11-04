import {FILE_CHUNK_BYTES,chunkKey} from './kv-files.mjs';

export async function purgeEdition(env,id,confirmation){
 const db=env.DB;
 const answer=(data,status=200)=>new Response(JSON.stringify(data),{status,headers:{'Content-Type':'application/json','Cache-Control':'no-store'}});
 if(confirmation!=='영구 삭제')return answer({error:'확인란에 영구 삭제를 입력해 주세요.'},400);
 if(!env.PDF_STORAGE)return answer({error:'현재 저장소에서는 이 기능을 사용할 수 없습니다.'},503);
 const edition=await db.prepare('SELECT * FROM prism_editions WHERE id=?').bind(id).first();
 if(!edition)return answer({error:'신문을 찾을 수 없습니다.'},404);
 if(!edition.deleted_at)return answer({error:'휴지통에 있는 신문만 영구 삭제할 수 있습니다.'},409);
 if(edition.purged_at)return answer({ok:true,done:true});
 const time=new Date().toISOString();
 // Restoration and purge admission both use conditional writes to the same row.
 const lock=await db.prepare('UPDATE prism_editions SET purge_started_at=COALESCE(purge_started_at,?) WHERE id=? AND deleted_at IS NOT NULL AND purged_at IS NULL RETURNING id').bind(time,id).first();
 if(!lock)return answer({error:'신문 상태가 변경됐습니다. 목록을 다시 확인해 주세요.'},409);
 await db.prepare('INSERT OR IGNORE INTO prism_purge_jobs (edition_id,cursor) VALUES (?,0)').bind(id).run();
 const versions=(await db.prepare('SELECT id,object_key,size FROM prism_versions WHERE edition_id=? ORDER BY id').bind(id).all()).results;
 const parts=[];for(const version of versions)if(version.object_key)for(let i=0;i<Math.ceil(version.size/FILE_CHUNK_BYTES);i++)parts.push(chunkKey(version.object_key,i));
 const job=await db.prepare('SELECT cursor FROM prism_purge_jobs WHERE edition_id=?').bind(id).first();
 if(!job)return answer({ok:true,done:true});
 const end=Math.min(parts.length,job.cursor+8);
 // Keep each invocation below the free Worker's request limits. Repeating a
 // successful delete is safe if a request fails before its cursor is committed.
 for(let i=job.cursor;i<end;i++)await env.PDF_STORAGE.delete(parts[i]);
 await db.prepare('UPDATE prism_purge_jobs SET cursor=MAX(cursor,?) WHERE edition_id=?').bind(end,id).run();
 if(end<parts.length)return answer({ok:true,done:false,processed:end,total:parts.length});
 await db.batch([
  db.prepare('DELETE FROM prism_upload_parts WHERE version_id IN (SELECT id FROM prism_versions WHERE edition_id=?)').bind(id),
  db.prepare('DELETE FROM prism_versions WHERE edition_id=?').bind(id),
  db.prepare('UPDATE prism_editions SET purged_at=?,current_version=NULL,pending_version=NULL,updated_at=? WHERE id=? AND deleted_at IS NOT NULL AND purged_at IS NULL').bind(time,time,id),
  db.prepare("INSERT OR IGNORE INTO prism_audit (id,action,edition_id,detail,created_at) VALUES (?,?,?,?,?)").bind('purge-'+id,'purge',id,edition.label+' · PDF와 모든 수정본 영구 삭제',time),
  db.prepare('DELETE FROM prism_purge_jobs WHERE edition_id=?').bind(id)
 ]);
 return answer({ok:true,done:true,processed:end,total:parts.length});
}
