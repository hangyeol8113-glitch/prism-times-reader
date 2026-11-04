import seed from '../data/seed-editions.json';
import qrCode from 'qrcode-generator';
import {zipSync,strToU8} from 'fflate';
import {hashPassword,verifyPassword,digest,randomToken,sessionToken,sessionCookie,validMutation,SESSION_SECONDS} from './auth.mjs';
const initialized=new WeakMap();
const now=()=>new Date().toISOString();
const json=(data,status=200,headers={})=>new Response(JSON.stringify(data),{status,headers:{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff',...headers}});
function problem(message,status=400){const e=new Error(message);e.status=status;throw e;}
const stmt=(db,sql,...args)=>db.prepare(sql).bind(...args);
const all=async(db,sql,...args)=>(await stmt(db,sql,...args).all()).results;
const first=(db,sql,...args)=>stmt(db,sql,...args).first();
async function body(request){if(Number(request.headers.get('Content-Length'))>20000)problem('입력 내용이 너무 큽니다.');let b;try{b=await request.json();}catch{problem('입력 형식을 확인해 주세요.');}if(!b||typeof b!=='object'||Array.isArray(b))problem('입력 형식을 확인해 주세요.');return b;}
function short(value,name,max=150){if(typeof value!=='string'||!value.trim()||value.trim().length>max)problem(name+'을 확인해 주세요.');return value.trim();}
export async function initialize(env){
 if(!env.DB||!env.BUCKET)problem('서버 저장소 설정을 확인해 주세요.',503);
 if(!initialized.has(env.DB))initialized.set(env.DB,(async()=>{
  const db=env.DB,t=now(),sql=[];
  for(const e of seed.editions){const v='seed-'+e.id;sql.push(stmt(db,'INSERT OR IGNORE INTO prism_editions (id,year,title,label,language,is_demo,sample_notice,sections,current_version,published,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,1,?,?)',e.id,2026,e.title,e.label,e.language||'ko',e.isDemo?1:0,e.sampleNotice||null,JSON.stringify(e.sections||[]),v,t,t));sql.push(stmt(db,"INSERT OR IGNORE INTO prism_versions (id,edition_id,source_path,filename,size,page_count,status,created_at,published_at) VALUES (?,?,?,?,?,16,'ready',?,?)",v,e.id,e.pdf,e.pdf.split('/').pop(),e.id==='2026-preview'?168543:22709013,t,t));}
  sql.push(stmt(db,'INSERT OR IGNORE INTO prism_settings (key,value) VALUES (?,?)','defaultIssue',seed.defaultIssue));await db.batch(sql);
 })().catch(e=>{initialized.delete(env.DB);throw e;}));return initialized.get(env.DB);
}
async function authRecord(env){let r=await first(env.DB,"SELECT value FROM prism_settings WHERE key='auth'");if(!r){if(!env.ADMIN_PASSWORD_HASH)problem('관리자 비밀번호가 아직 설정되지 않았습니다.',503);await stmt(env.DB,"INSERT OR IGNORE INTO prism_settings (key,value) VALUES ('auth',?)",JSON.stringify({hash:env.ADMIN_PASSWORD_HASH,epoch:1})).run();r=await first(env.DB,"SELECT value FROM prism_settings WHERE key='auth'");}return JSON.parse(r.value);}
async function authenticated(request,env){const token=sessionToken(request);if(!token)return false;const auth=await authRecord(env);return !!(await first(env.DB,'SELECT token_hash FROM prism_sessions WHERE token_hash=? AND epoch=? AND expires_at>?',await digest(token),auth.epoch,Math.floor(Date.now()/1000)));}
async function newSession(request,env,epoch){const token=randomToken();await stmt(env.DB,'INSERT INTO prism_sessions (token_hash,epoch,expires_at) VALUES (?,?,?)',await digest(token),epoch,Math.floor(Date.now()/1000)+SESSION_SECONDS).run();return sessionCookie(token,request);}
const auditStmt=(db,action,id,detail)=>stmt(db,'INSERT INTO prism_audit (id,action,edition_id,detail,created_at) VALUES (?,?,?,?,?)',crypto.randomUUID(),action,id,detail,now());
function issueConfig(e,v){return{id:e.id,title:e.title,label:e.label,language:e.language,isDemo:!!e.is_demo,sampleNotice:e.sample_notice||undefined,sections:JSON.parse(e.sections||'[]'),pdf:'/api/prism/files/'+v.id,pageCount:v.page_count};}
export async function publicConfig(env){await initialize(env);const editions=await all(env.DB,'SELECT e.*,v.id AS version_id,v.page_count FROM prism_editions e JOIN prism_versions v ON v.id=e.current_version WHERE e.published=1 AND e.deleted_at IS NULL');const def=await first(env.DB,"SELECT value FROM prism_settings WHERE key='defaultIssue'");return{schemaVersion:1,publication:'PRISM-TIMES',defaultIssue:def?.value??'',removedIssueIds:(await all(env.DB,'SELECT id FROM prism_editions WHERE deleted_at IS NOT NULL AND published=1')).map(e=>e.id),editions:editions.map(e=>issueConfig(e,{id:e.version_id,page_count:e.page_count}))};}
export async function publicConfigResponse(env){try{return json(await publicConfig(env));}catch(e){console.error('Public configuration failed',e);return json({error:'신문 정보를 불러오지 못했습니다.'},503);}}
function pageURL(request,issue,page){const u=new URL('/',request.url);u.searchParams.set('issue',issue);u.searchParams.set('page',String(page));return u.href;}
export function parseRange(value,size){if(!value)return null;const m=/^bytes=(\d*)-(\d*)$/.exec(value);if(!m||(!m[1]&&!m[2]))return false;let start,end;if(!m[1]){const n=Number(m[2]);if(!Number.isSafeInteger(n)||n<=0)return false;start=Math.max(0,size-n);end=size-1;}else{start=Number(m[1]);end=m[2]?Number(m[2]):size-1;}if(!Number.isSafeInteger(start)||!Number.isSafeInteger(end)||start<0||start>=size||end<start)return false;end=Math.min(end,size-1);return{offset:start,length:end-start+1};}
async function serveFile(request,env,id){const v=await first(env.DB,"SELECT v.*,e.deleted_at FROM prism_versions v JOIN prism_editions e ON e.id=v.edition_id WHERE v.id=? AND v.status='ready'",id);if(!v)problem('파일을 찾을 수 없습니다.',404);if(v.deleted_at){if(!await authenticated(request,env))problem('관리자가 삭제한 신문입니다.',410);}else if(!v.published_at&&!await authenticated(request,env))problem('관리자 로그인이 필요합니다.',401);
 if(v.source_path){const u=new URL('/'+v.source_path,request.url);return new Response(null,{status:302,headers:{Location:u.href,'Cache-Control':'no-store'}});}
 const range=parseRange(request.headers.get('Range'),v.size);if(range===false)return new Response(null,{status:416,headers:{'Content-Range':`bytes */${v.size}`}});
 const headers={'Content-Type':'application/pdf','Content-Disposition':`inline; filename="${v.id}.pdf"`,'Accept-Ranges':'bytes','X-Content-Type-Options':'nosniff','Cache-Control':v.published_at&&!v.deleted_at?'public, max-age=0, must-revalidate':'private, no-store','Content-Length':String(range?range.length:v.size)};
 if(range)headers['Content-Range']=`bytes ${range.offset}-${range.offset+range.length-1}/${v.size}`;
 if(request.method==='HEAD')return new Response(null,{status:range?206:200,headers});
 const object=await env.BUCKET.get(v.object_key,range?{range}:undefined);if(!object)problem('저장된 PDF를 찾을 수 없습니다.',404);headers.ETag=object.httpEtag;return new Response(object.body,{status:range?206:200,headers});
}
export async function handleAPI(request,env){try{
 await initialize(env);const db=env.DB,u=new URL(request.url),path=u.pathname.replace(/^\/api\/prism\/?/,''),method=request.method;
 if(!['GET','HEAD','POST','PUT'].includes(method))problem('지원하지 않는 요청입니다.',405);
 if(['POST','PUT'].includes(method)&&!validMutation(request))problem('요청 출처를 확인할 수 없습니다. 관리자 화면에서 다시 시도해 주세요.',403);
 if(path==='session'&&method==='GET')return json({authenticated:await authenticated(request,env)});
 if(path==='login'&&method==='POST'){
  const b=await body(request),key=await digest('login:'+ (request.headers.get('CF-Connecting-IP')||'local')),time=Math.floor(Date.now()/1000);
  const row=await stmt(db,'INSERT INTO prism_login_attempts (key,count,expires_at) VALUES (?,1,?) ON CONFLICT(key) DO UPDATE SET count=CASE WHEN expires_at<=? THEN 1 ELSE count+1 END,expires_at=CASE WHEN expires_at<=? THEN ? ELSE expires_at END RETURNING count,expires_at',key,time+300,time,time,time+300).first();
  if(row.count>8)return json({error:'로그인을 여러 번 시도했습니다. 5분 뒤 다시 시도해 주세요.'},429,{'Retry-After':String(Math.max(1,row.expires_at-time))});
  const auth=await authRecord(env);if(!await verifyPassword(b.password,auth.hash))problem('비밀번호가 맞지 않습니다.',401);
  await db.batch([stmt(db,'DELETE FROM prism_login_attempts WHERE key=?',key),stmt(db,'DELETE FROM prism_sessions WHERE expires_at<=?',time)]);
  return json({ok:true},200,{'Set-Cookie':await newSession(request,env,auth.epoch)});
 }
 if(path==='logout'&&method==='POST'){const token=sessionToken(request);if(token)await stmt(db,'DELETE FROM prism_sessions WHERE token_hash=?',await digest(token)).run();return json({ok:true},200,{'Set-Cookie':sessionCookie('',request,0)});}
 if(path.startsWith('files/')&&['GET','HEAD'].includes(method))return await serveFile(request,env,path.slice(6));
 if(!path.startsWith('admin/')||!await authenticated(request,env))problem('관리자 로그인이 필요합니다.',401);
 if(path==='admin/editions'&&method==='GET')return json({defaultIssue:(await first(db,"SELECT value FROM prism_settings WHERE key='defaultIssue'")).value,editions:await all(db,'SELECT e.*,v.page_count,v.size,v.filename,p.page_count AS pending_pages,p.filename AS pending_filename FROM prism_editions e LEFT JOIN prism_versions v ON v.id=e.current_version LEFT JOIN prism_versions p ON p.id=e.pending_version WHERE e.deleted_at IS NULL ORDER BY e.year DESC,e.created_at DESC'),trashCount:(await first(db,'SELECT COUNT(*) AS count FROM prism_editions WHERE deleted_at IS NOT NULL')).count});
 if(path==='admin/trash'&&method==='GET')return json({editions:await all(db,'SELECT e.*,v.page_count,v.size,v.filename FROM prism_editions e LEFT JOIN prism_versions v ON v.id=e.current_version WHERE e.deleted_at IS NOT NULL ORDER BY e.deleted_at DESC')});
 const trashAction=/^admin\/editions\/([^/]+)\/(trash|restore)$/.exec(path);
 if(trashAction&&method==='POST'){
  const [,id,action]=trashAction,b=await body(request),e=await first(db,'SELECT * FROM prism_editions WHERE id=?',id);if(!e)problem('신문을 찾을 수 없습니다.',404);
  const t=now();let results;
  if(action==='trash'){
   if(e.deleted_at)problem('이미 휴지통에 있는 신문입니다.',409);
   const replacement=typeof b.replacementId==='string'?b.replacementId:'';
   if(replacement&&!await first(db,'SELECT id FROM prism_editions WHERE id=? AND id!=? AND published=1 AND deleted_at IS NULL',replacement,id))problem('대신 열 신문을 다시 선택해 주세요.',409);
   results=await db.batch([
    stmt(db,"UPDATE prism_editions SET deleted_at=?,updated_at=? WHERE id=? AND deleted_at IS NULL AND (id!=(SELECT value FROM prism_settings WHERE key='defaultIssue') OR EXISTS(SELECT 1 FROM prism_editions WHERE id=? AND id!=? AND published=1 AND deleted_at IS NULL) OR NOT EXISTS(SELECT 1 FROM prism_editions WHERE id!=? AND published=1 AND deleted_at IS NULL)) RETURNING id",t,t,id,replacement,id,id),
    stmt(db,"UPDATE prism_settings SET value=? WHERE key='defaultIssue' AND value=? AND EXISTS(SELECT 1 FROM prism_editions WHERE id=? AND deleted_at=?)",replacement,id,id,t),
    stmt(db,'INSERT INTO prism_audit (id,action,edition_id,detail,created_at) SELECT ?,?,?,?,? WHERE EXISTS(SELECT 1 FROM prism_editions WHERE id=? AND deleted_at=?)',crypto.randomUUID(),'trash',id,e.label+' 휴지통으로 이동',t,id,t)
   ]);
   if(!results[0].results.length)problem('기본 신문을 삭제하려면 대신 열 신문을 선택해 주세요. 목록이 바뀌었다면 새로고침 후 다시 시도해 주세요.',409);
  }else{
   if(!e.deleted_at)problem('이미 복원된 신문입니다.',409);
   results=await db.batch([
    stmt(db,'UPDATE prism_editions SET deleted_at=NULL,updated_at=? WHERE id=? AND deleted_at IS NOT NULL RETURNING id',t,id),
    stmt(db,"UPDATE prism_settings SET value=? WHERE key='defaultIssue' AND value='' AND EXISTS(SELECT 1 FROM prism_editions WHERE id=? AND published=1 AND deleted_at IS NULL)",id,id),
    stmt(db,'INSERT INTO prism_audit (id,action,edition_id,detail,created_at) SELECT ?,?,?,?,? WHERE EXISTS(SELECT 1 FROM prism_editions WHERE id=? AND deleted_at IS NULL AND updated_at=?)',crypto.randomUUID(),'restore',id,e.label+' 복원',t,id,t)
   ]);
   if(!results[0].results.length)problem('신문 상태가 바뀌었습니다. 새로고침해 주세요.',409);
  }
  return json({ok:true});
 }
 if(path==='admin/editions'&&method==='POST'){
  const b=await body(request),id=short(b.id,'호 ID',64);if(!/^[a-z0-9][a-z0-9_-]{2,63}$/.test(id))problem('호 ID는 영문 소문자·숫자·-·_ 3~64자로 입력해 주세요.');
  if(!Number.isInteger(b.year)||b.year<2020||b.year>2100)problem('발행 연도를 확인해 주세요.');if(await first(db,'SELECT id FROM prism_editions WHERE id=?',id))problem('이미 사용 중인 호 ID입니다. 휴지통에 있다면 복원해 주세요.',409);
  const title=short(b.title,'신문 제목'),label=short(b.label,'표시 이름'),t=now();await db.batch([stmt(db,'INSERT INTO prism_editions (id,year,title,label,language,created_at,updated_at) VALUES (?,?,?,?,?,?,?)',id,b.year,title,label,b.language==='en'?'en':'ko',t,t),auditStmt(db,'create',id,label+' 등록')]);return json({id},201);
 }
 const edit=/^admin\/editions\/([^/]+)$/.exec(path);
 if(edit&&method==='PUT'){const b=await body(request),id=edit[1];if(!await first(db,'SELECT id FROM prism_editions WHERE id=? AND deleted_at IS NULL',id))problem('신문을 찾을 수 없습니다.',404);await db.batch([stmt(db,'UPDATE prism_editions SET title=?,label=?,updated_at=? WHERE id=? AND deleted_at IS NULL',short(b.title,'제목'),short(b.label,'표시 이름'),now(),id),auditStmt(db,'metadata',id,'제목과 표시 이름 수정')]);return json({ok:true});}
 const history=/^admin\/editions\/([^/]+)\/versions$/.exec(path);
 if(history&&method==='GET')return json({versions:await all(db,"SELECT id,edition_id,filename,size,page_count,status,created_at,published_at FROM prism_versions WHERE edition_id=? AND status='ready' ORDER BY created_at DESC",history[1])});
 if(path==='admin/uploads'&&method==='POST'){
  const b=await body(request);if(!await first(db,'SELECT id FROM prism_editions WHERE id=? AND deleted_at IS NULL',String(b.editionId)))problem('신문을 먼저 등록해 주세요.');
  if(!Number.isInteger(b.size)||b.size<5||b.size>95*1024*1024||!Number.isInteger(b.pageCount)||b.pageCount<1||b.pageCount>500)problem('PDF는 95MB 이하, 1~500쪽으로 올려 주세요.');
  const id=crypto.randomUUID(),filename=short(b.filename,'파일 이름',180);await stmt(db,"INSERT INTO prism_versions (id,edition_id,object_key,filename,size,page_count,status,created_at) VALUES (?,?,?,?,?,?,'uploading',?)",id,b.editionId,'newspapers/'+b.editionId+'/'+id+'.pdf',filename,b.size,b.pageCount,now()).run();return json({id,url:'/api/prism/admin/uploads/'+id},201);
 }
 const upload=/^admin\/uploads\/([^/]+)$/.exec(path);
 if(upload&&method==='PUT'){
  if(!request.body||request.headers.get('Content-Type')?.split(';')[0]!=='application/pdf')problem('PDF 파일을 올려 주세요.');
  const v=await stmt(db,"UPDATE prism_versions SET status='receiving' WHERE id=? AND status='uploading' AND EXISTS(SELECT 1 FROM prism_editions WHERE id=prism_versions.edition_id AND deleted_at IS NULL) RETURNING *",upload[1]).first();if(!v)problem('업로드 요청이 만료되었거나 이미 처리되었습니다.',409);
  const length=Number(request.headers.get('Content-Length'));if(length&&length!==v.size){await stmt(db,"UPDATE prism_versions SET status='failed' WHERE id=?",v.id).run();problem('파일 크기가 맞지 않습니다.');}
  try{const fixed=new FixedLengthStream(v.size);const transfer=request.body.pipeTo(fixed.writable);const [result]=await Promise.all([env.BUCKET.put(v.object_key,fixed.readable,{httpMetadata:{contentType:'application/pdf'}}),transfer]);if(result.size!==v.size){await env.BUCKET.delete(v.object_key);problem('파일 전송이 완료되지 않았습니다.');}
   await db.batch([stmt(db,"UPDATE prism_versions SET status='ready' WHERE id=?",v.id),stmt(db,'UPDATE prism_editions SET pending_version=?,updated_at=? WHERE id=? AND deleted_at IS NULL',v.id,now(),v.edition_id),auditStmt(db,'upload',v.edition_id,`${v.filename} · ${v.page_count}쪽 저장`)]);return json({ok:true,id:v.id});
  }catch(e){await env.BUCKET.delete(v.object_key).catch(()=>{});await stmt(db,"UPDATE prism_versions SET status='failed' WHERE id=?",v.id).run();throw e;}
 }
 const preview=/^admin\/preview\/([^/]+)$/.exec(path);
 if(preview&&method==='GET'){const v=await first(db,"SELECT * FROM prism_versions WHERE id=? AND status='ready'",preview[1]);if(!v)problem('미리볼 파일이 없습니다.',404);const e=await first(db,'SELECT * FROM prism_editions WHERE id=?',v.edition_id);return json(issueConfig(e,v));}
 if(path==='admin/publish'&&method==='POST'){
  const b=await body(request),v=await first(db,"SELECT v.* FROM prism_versions v JOIN prism_editions e ON e.id=v.edition_id WHERE v.id=? AND v.edition_id=? AND v.status='ready' AND e.deleted_at IS NULL",String(b.versionId),String(b.editionId));if(!v)problem('게시할 PDF를 먼저 저장해 주세요.');
  const sql=[stmt(db,'UPDATE prism_editions SET published=1,current_version=?,pending_version=CASE WHEN pending_version=? THEN NULL ELSE pending_version END,updated_at=? WHERE id=? AND deleted_at IS NULL RETURNING id',v.id,v.id,now(),v.edition_id),stmt(db,'UPDATE prism_versions SET published_at=COALESCE(published_at,?) WHERE id=? AND EXISTS(SELECT 1 FROM prism_editions WHERE id=prism_versions.edition_id AND deleted_at IS NULL)',now(),v.id),auditStmt(db,'publish',v.edition_id,`${v.filename} 게시${b.makeDefault?' · 기본 신문으로 설정':''}`)];if(b.makeDefault)sql.push(stmt(db,"UPDATE prism_settings SET value=? WHERE key='defaultIssue' AND EXISTS(SELECT 1 FROM prism_editions WHERE id=? AND published=1 AND deleted_at IS NULL)",v.edition_id,v.edition_id));const result=await db.batch(sql);if(!result[0].results.length)problem('휴지통에 있는 신문은 복원 후 게시해 주세요.',409);return json({ok:true});
 }
 if(path==='admin/default'&&method==='POST'){const b=await body(request);if(!await first(db,'SELECT id FROM prism_editions WHERE id=? AND published=1 AND deleted_at IS NULL',String(b.editionId)))problem('게시된 신문만 기본으로 설정할 수 있습니다.');const result=await db.batch([stmt(db,"UPDATE prism_settings SET value=? WHERE key='defaultIssue' AND EXISTS(SELECT 1 FROM prism_editions WHERE id=? AND published=1 AND deleted_at IS NULL) RETURNING value",b.editionId,b.editionId),auditStmt(db,'default',b.editionId,'기본으로 열 신문 변경')]);if(!result[0].results.length)problem('신문 상태가 바뀌었습니다. 다시 선택해 주세요.',409);return json({ok:true});}
 if(path==='admin/audit'&&method==='GET')return json({events:await all(db,'SELECT * FROM prism_audit ORDER BY created_at DESC LIMIT 100')});
 if(path==='admin/password'&&method==='POST'){
  const b=await body(request),auth=await authRecord(env);if(!await verifyPassword(b.current,auth.hash))problem('현재 비밀번호가 맞지 않습니다.');if(typeof b.next!=='string'||b.next.length<8||b.next.length>100)problem('새 비밀번호는 8~100자로 입력해 주세요.');const next={hash:await hashPassword(b.next),epoch:auth.epoch+1};
  const updated=await stmt(db,"UPDATE prism_settings SET value=? WHERE key='auth' AND value=? RETURNING key",JSON.stringify(next),JSON.stringify(auth)).first();if(!updated)problem('다른 관리자가 비밀번호를 변경했습니다. 다시 로그인해 주세요.',409);await db.batch([stmt(db,'DELETE FROM prism_sessions'),auditStmt(db,'password',null,'관리자 비밀번호 변경 · 기존 로그인 종료')]);return json({ok:true},200,{'Set-Cookie':await newSession(request,env,next.epoch)});
 }
 if(path==='admin/backup'&&method==='GET')return json({schemaVersion:1,exportedAt:now(),origin:u.origin,defaultIssue:(await first(db,"SELECT value FROM prism_settings WHERE key='defaultIssue'")).value,editions:await all(db,'SELECT * FROM prism_editions'),versions:(await all(db,"SELECT id,edition_id,filename,size,page_count,created_at,published_at FROM prism_versions WHERE status='ready'")).map(v=>({...v,url:'/api/prism/files/'+v.id})),publicConfig:await publicConfig(env),audit:await all(db,'SELECT * FROM prism_audit ORDER BY created_at DESC')});
 if(['admin/qr','admin/qr-all'].includes(path)&&method==='GET'){
  const e=await first(db,'SELECT e.*,v.page_count FROM prism_editions e JOIN prism_versions v ON v.id=e.current_version WHERE e.id=? AND e.published=1 AND e.deleted_at IS NULL',u.searchParams.get('issue')||'');if(!e)problem('게시된 신문을 선택해 주세요.');
  const svg=p=>{const qr=qrCode(0,'M');qr.addData(pageURL(request,e.id,p));qr.make();return qr.createSvgTag({cellSize:8,margin:32,scalable:true});};
  if(path==='admin/qr'){const p=Number(u.searchParams.get('page'));if(!Number.isInteger(p)||p<1||p>e.page_count)problem('쪽수를 확인해 주세요.');return new Response(svg(p),{headers:{'Content-Type':'image/svg+xml','Content-Disposition':`attachment; filename="${e.id}-page-${p}.svg"`,'Cache-Control':'no-store'}});}
  const files={},lines=['page,url'];for(let p=1;p<=e.page_count;p++){files[`page-${String(p).padStart(3,'0')}.svg`]=strToU8(svg(p));lines.push(p+','+pageURL(request,e.id,p));}files['links.csv']=strToU8('\ufeff'+lines.join('\r\n'));return new Response(zipSync(files),{headers:{'Content-Type':'application/zip','Content-Disposition':`attachment; filename="${e.id}-QR.zip"`,'Cache-Control':'no-store'}});
 }
 problem('요청한 기능을 찾을 수 없습니다.',404);
 }catch(e){if(!e.status)console.error('PRISM API error',e);return json({error:e.status?e.message:'서버에서 처리하지 못했습니다. 잠시 후 다시 시도해 주세요.'},e.status||500);}}
