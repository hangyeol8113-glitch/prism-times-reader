import {emitKeypressEvents} from 'node:readline';
import {spawnSync} from 'node:child_process';
import {hashPassword} from '../server/auth.mjs';
if(!process.stdin.isTTY){console.error('비밀번호는 터미널에서 직접 입력해 주세요.');process.exit(1);}
async function hidden(prompt){process.stdout.write(prompt);emitKeypressEvents(process.stdin);process.stdin.setRawMode(true);process.stdin.resume();let value='';try{return await new Promise((resolve,reject)=>{function onKey(text,key){if(key?.ctrl&&key.name==='c'){cleanup();reject(Error('취소했습니다.'));}else if(key?.name==='return'){cleanup();resolve(value);}else if(key?.name==='backspace')value=value.slice(0,-1);else if(text&&!key?.ctrl&&!key?.meta&&value.length<100)value+=text;}function cleanup(){process.stdin.off('keypress',onKey);}process.stdin.on('keypress',onKey);});}finally{process.stdin.setRawMode(false);process.stdin.pause();process.stdout.write('\n');}}
const password=await hidden('관리자 비밀번호 (화면에 표시되지 않습니다): ');
if(password.length<8||password!==await hidden('한 번 더 입력: ')){console.error('8자 이상으로 입력하고, 두 입력이 같아야 합니다.');process.exit(1);}
const hash=await hashPassword(password);
const result=spawnSync(process.execPath,['node_modules/wrangler/bin/wrangler.js','secret','put','ADMIN_PASSWORD_HASH'],{input:hash+'\n',stdio:['pipe','inherit','inherit'],cwd:new URL('..',import.meta.url)});
process.exit(result.status??1);
