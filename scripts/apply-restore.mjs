import {readFile,stat} from 'node:fs/promises';
import {resolve} from 'node:path';
import {spawnSync} from 'node:child_process';
const directory=resolve(process.argv[2]||'restore-output'),config=JSON.parse(await readFile('wrangler.json','utf8')),plan=JSON.parse(await readFile(resolve(directory,'upload-plan.json'),'utf8'));
if(!process.argv.includes('--apply')){console.log(`복구 대상: ${config.name} / DB ${config.d1_databases?.[0]?.database_name} / R2 ${config.r2_buckets?.[0]?.bucket_name}\n${plan.editionCount}개 호 / ${plan.versionCount}개 PDF\n검토 후 실행: node scripts/apply-restore.mjs ${JSON.stringify(directory)} --apply`);process.exit(0);}
if(config.d1_databases?.[0]?.database_id?.includes('REPLACE'))throw Error('wrangler.json의 실제 계정 저장소 설정을 먼저 완료하세요.');
const bucket=config.r2_buckets?.find(b=>b.binding==='BUCKET')?.bucket_name;if(!bucket)throw Error('R2 BUCKET 설정이 없습니다.');
for(const f of plan.files){if(!/^newspapers\/[a-z0-9_-]+\/[a-zA-Z0-9_-]+\.pdf$/.test(f.key)||(await stat(f.file)).size!==f.size)throw Error('복구할 PDF 정보를 확인해 주세요.');}
function run(args){const r=spawnSync(process.execPath,['node_modules/wrangler/bin/wrangler.js',...args],{stdio:'inherit'});if(r.status!==0)throw Error('복구를 중단했습니다. 이미 저장된 PDF는 다음 실행에 재사용할 수 있습니다.');}
for(const [i,f] of plan.files.entries()){console.log(`PDF ${i+1}/${plan.files.length}`);run(['r2','object','put',bucket+'/'+f.key,'--file',f.file,'--content-type','application/pdf','--remote']);}
run(['d1','execute','DB','--remote','--file',resolve(directory,'data.sql')]);console.log('PDF와 발행 정보 복구를 완료했습니다. 새 사이트에서 기본 신문, QR, 휴지통을 확인해 주세요.');
