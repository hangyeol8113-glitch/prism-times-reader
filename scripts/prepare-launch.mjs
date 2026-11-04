import {readFile,writeFile,mkdir,copyFile} from 'node:fs/promises';
import {resolve,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import {prepareRestore} from './prepare-restore.mjs';

const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const source=resolve(root,'newspapers','2026 프리즘타임즈 영자신문(한국어본).pdf');
const bytes=await readFile(source);
const blobHash=createHash('sha1').update(Buffer.from(`blob ${bytes.length}\0`)).update(bytes).digest('hex');
if(blobHash!=='283518dd735d27f41aaf0ffdf1acda2fa403474f')throw Error('확인한 한국어 PDF 원본과 다릅니다. 파일을 확인해 주세요.');
const id='2026-01',version='launch-2026-ko-v1',time=new Date().toISOString();
const backup=resolve(root,'restore-output','launch-source');
await mkdir(resolve(backup,'reader','papers',id),{recursive:true});
await copyFile(source,resolve(backup,'reader','papers',id,version+'.pdf'));
const edition={id,year:2026,title:'2026 PRISM-TIMES 한국어판',label:'2026 · 한국어판',language:'ko',is_demo:0,sections:JSON.stringify(Array.from({length:16},(_,i)=>i===0?'표지':`${i+1}쪽`)),current_version:version,pending_version:null,published:1,deleted_at:null,created_at:time,updated_at:time};
const data={schemaVersion:1,origin:null,defaultIssue:id,editions:[edition],versions:[{id:version,edition_id:id,filename:'2026 프리즘타임즈 영자신문(한국어본).pdf',size:bytes.length,page_count:16,created_at:time,published_at:time}],audit:[]};
await writeFile(resolve(backup,'management-data.json'),JSON.stringify(data,null,2));
const output=resolve(root,'restore-output','launch');
const plan=await prepareRestore(backup,output);
// Preserve demo records as removed so initialization never republishes them.
const seed=JSON.parse(await readFile(resolve(root,'data','seed-editions.json'),'utf8'));
const quote=s=>"'"+s.replaceAll("'","''")+"'";
const tombstones=seed.editions.filter(e=>e.isDemo).map(e=>`INSERT OR IGNORE INTO prism_editions (id,year,title,label,language,is_demo,sections,published,deleted_at,created_at,updated_at) VALUES (${quote(e.id)},2026,${quote(e.title)},${quote(e.label)},'ko',1,'[]',0,${quote(time)},${quote(time)},${quote(time)});\nUPDATE prism_editions SET deleted_at=${quote(time)}, published=0 WHERE id=${quote(e.id)} AND is_demo=1;`).join('\n');
await writeFile(resolve(output,'data.sql'),await readFile(resolve(output,'data.sql'),'utf8')+'\n'+tombstones+'\n');
console.log(`준비 완료: ${plan.editionCount}개 호 / 한국어 PDF 16쪽. 서버는 아직 변경하지 않았습니다.`);
console.log('검토 후 실행: node scripts/apply-restore.mjs restore-output/launch --apply');
