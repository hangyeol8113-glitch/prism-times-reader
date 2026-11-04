import {readFile,writeFile,mkdir,stat,open} from 'node:fs/promises';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
const literal=v=>v===null||v===undefined?'NULL':typeof v==='number'&&Number.isFinite(v)?String(v):"'"+String(v).replaceAll("'","''")+"'";
function upsert(table,columns,row){const fields=columns.filter(k=>k in row);return `INSERT INTO ${table} (${fields.join(',')}) VALUES (${fields.map(k=>literal(row[k])).join(',')}) ON CONFLICT(id) DO UPDATE SET ${fields.filter(k=>k!=='id').map(k=>k+'=excluded.'+k).join(',')};`;}
export async function prepareRestore(backupDirectory,outputDirectory){
 const directory=resolve(backupDirectory),output=resolve(outputDirectory),data=JSON.parse(await readFile(resolve(directory,'management-data.json'),'utf8'));
 if(data.schemaVersion!==1||!Array.isArray(data.editions)||!Array.isArray(data.versions))throw Error('현재 관리실의 전체 백업을 압축 해제한 폴더를 선택해 주세요.');
 const editions=new Map(),versions=new Map(),files=[],sql=[];
 for(const e of data.editions){if(!/^[a-z0-9][a-z0-9_-]{2,63}$/.test(e.id)||editions.has(e.id))throw Error('중복되거나 올바르지 않은 호 ID입니다.');editions.set(e.id,e);}
 for(const v of data.versions){if(!/^[a-zA-Z0-9_-]{1,120}$/.test(v.id)||!editions.has(v.edition_id)||versions.has(v.id))throw Error('PDF 버전 정보를 확인해 주세요.');versions.set(v.id,v);
  const file=resolve(directory,'reader','papers',v.edition_id,v.id+'.pdf'),info=await stat(file);if(info.size!==v.size||info.size<5)throw Error('PDF 파일이 없거나 크기가 맞지 않습니다: '+v.filename);
  const handle=await open(file,'r');try{const buf=Buffer.alloc(Math.min(info.size,1024));await handle.read(buf,0,buf.length,0);if(!buf.includes(Buffer.from('%PDF-')))throw Error('PDF 형식을 확인해 주세요: '+v.filename);}finally{await handle.close();}
  const key='newspapers/'+v.edition_id+'/'+v.id+'.pdf';files.push({file,key,size:v.size});sql.push(upsert('prism_versions',['id','edition_id','object_key','source_path','filename','size','page_count','status','created_at','published_at'],{...v,object_key:key,source_path:null,status:'ready'}));
 }
 for(const e of editions.values()){for(const key of ['current_version','pending_version'])if(e[key]&&!versions.has(e[key]))throw Error(e.id+'의 '+key+' PDF가 백업에 없습니다.');sql.push(upsert('prism_editions',['id','year','title','label','language','is_demo','sample_notice','sections','current_version','pending_version','published','deleted_at','created_at','updated_at'],e));}
 const def=data.defaultIssue||'';if(def&&(!editions.has(def)||!editions.get(def).published||editions.get(def).deleted_at))throw Error('기본 신문 설정을 확인해 주세요.');
 sql.push(`INSERT INTO prism_settings (key,value) VALUES ('defaultIssue',${literal(def)}) ON CONFLICT(key) DO UPDATE SET value=excluded.value;`);
 for(const e of data.audit||[])sql.push(`INSERT OR IGNORE INTO prism_audit (id,action,edition_id,detail,created_at) VALUES (${['id','action','edition_id','detail','created_at'].map(k=>literal(e[k])).join(',')});`);
 await mkdir(output,{recursive:true});await writeFile(resolve(output,'data.sql'),sql.join('\n')+'\n');const plan={schemaVersion:1,editionCount:editions.size,versionCount:versions.size,defaultIssue:def,sourceOrigin:data.origin,files};await writeFile(resolve(output,'upload-plan.json'),JSON.stringify(plan,null,2)+'\n');return plan;
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 if(!process.argv[2]){console.error('사용법: npm run restore:prepare -- 백업폴더 [출력폴더]');process.exit(1);}const plan=await prepareRestore(process.argv[2],process.argv[3]||'restore-output');console.log(`복구 계획 준비 완료: ${plan.editionCount}개 호 / ${plan.versionCount}개 PDF. 외부 서버에는 아직 변경하지 않았습니다.`);
}
