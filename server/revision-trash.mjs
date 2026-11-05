import {FILE_CHUNK_BYTES,chunkKey} from './kv-files.mjs';

export const revisionTrashSchema=`CREATE TABLE IF NOT EXISTS prism_version_trash (
 version_id TEXT PRIMARY KEY NOT NULL,
 deleted_at TEXT NOT NULL,
 purge_started_at TEXT,
 cursor INTEGER NOT NULL DEFAULT 0
)`;

// Replaced publications are archived, never removed from storage by publishing.
export const archiveReplacedSQL=`INSERT OR IGNORE INTO prism_version_trash (version_id,deleted_at)
 SELECT v.id,? FROM prism_versions v JOIN prism_editions e ON e.id=v.edition_id
 WHERE v.status='ready' AND v.published_at IS NOT NULL
 AND v.id!=COALESCE(e.current_version,'') AND v.id!=COALESCE(e.pending_version,'')`;

export async function revisionTrashAction(env,id,action,confirmation){
 const db=env.DB,answer=(data,status=200)=>new Response(JSON.stringify(data),{status,headers:{'Content-Type':'application/json','Cache-Control':'no-store'}});
 const version=await db.prepare(`SELECT v.*,t.purge_started_at,t.cursor,e.deleted_at AS edition_deleted_at
 FROM prism_versions v JOIN prism_version_trash t ON t.version_id=v.id
 JOIN prism_editions e ON e.id=v.edition_id WHERE v.id=?`).bind(id).first();
 if(!version)return answer({error:'휴지통의 PDF를 찾을 수 없습니다. 목록을 새로고침해 주세요.'},404);
 const eligible=`EXISTS(SELECT 1 FROM prism_editions e WHERE e.id=prism_versions.edition_id
 AND e.deleted_at IS NULL AND COALESCE(e.current_version,'')!=prism_versions.id
 AND COALESCE(e.pending_version,'')!=prism_versions.id)`;
 if(action==='restore'){
  if(version.purge_started_at||version.edition_deleted_at)return answer({error:'영구 삭제 중이거나 신문 자체가 휴지통에 있는 PDF는 복원할 수 없습니다.'},409);
  // Restored PDFs are unpublished revisions. Publishing is a separate decision.
  const result=await db.batch([
   db.prepare(`UPDATE prism_versions SET published_at=NULL WHERE id=? AND ${eligible}
    AND EXISTS(SELECT 1 FROM prism_version_trash t WHERE t.version_id=prism_versions.id AND t.purge_started_at IS NULL) RETURNING id`).bind(id),
   db.prepare(`DELETE FROM prism_version_trash WHERE version_id=? AND purge_started_at IS NULL
    AND EXISTS(SELECT 1 FROM prism_versions WHERE id=? AND published_at IS NULL AND ${eligible})`).bind(id,id)
  ]);
  return result[0].results.length?answer({ok:true}):answer({error:'PDF 상태가 바뀌었습니다. 목록을 새로고침해 주세요.'},409);
 }
 if(confirmation!=='영구 삭제')return answer({error:'확인란에 영구 삭제를 입력해 주세요.'},400);
 if(!env.PDF_STORAGE)return answer({error:'현재 저장소에서는 이 기능을 사용할 수 없습니다.'},503);
 const lock=await db.prepare(`UPDATE prism_version_trash SET purge_started_at=COALESCE(purge_started_at,?)
 WHERE version_id=? AND EXISTS(SELECT 1 FROM prism_versions WHERE id=? AND ${eligible}) RETURNING cursor,purge_started_at`).bind(new Date().toISOString(),id,id).first();
 if(!lock)return answer({error:'현재 게시본·게시 대기본 또는 삭제한 신문에 속한 PDF는 여기서 삭제할 수 없습니다.'},409);
 const count=version.object_key?Math.ceil(version.size/FILE_CHUNK_BYTES):0,end=Math.min(count,lock.cursor+8);
 for(let i=lock.cursor;i<end;i++)await env.PDF_STORAGE.delete(chunkKey(version.object_key,i));
 await db.prepare('UPDATE prism_version_trash SET cursor=MAX(cursor,?) WHERE version_id=?').bind(end,id).run();
 if(end<count)return answer({ok:true,done:false,processed:end,total:count});
 const guard=`EXISTS(SELECT 1 FROM prism_version_trash WHERE version_id=? AND purge_started_at=?)`;
 await db.batch([
  db.prepare(`DELETE FROM prism_upload_parts WHERE version_id=? AND ${guard}`).bind(id,id,lock.purge_started_at),
  db.prepare(`DELETE FROM prism_versions WHERE id=? AND ${eligible} AND ${guard}`).bind(id,id,lock.purge_started_at),
  db.prepare(`INSERT OR IGNORE INTO prism_audit (id,action,edition_id,detail,created_at)
   SELECT ?,'purge-version',?,?,? WHERE NOT EXISTS(SELECT 1 FROM prism_versions WHERE id=?)`).bind('purge-version-'+id,version.edition_id,version.filename+' · 이전 PDF 영구 삭제',new Date().toISOString(),id),
  db.prepare('DELETE FROM prism_version_trash WHERE version_id=? AND NOT EXISTS(SELECT 1 FROM prism_versions WHERE id=?)').bind(id,id)
 ]);
 return answer({ok:true,done:true,processed:end,total:count});
}
