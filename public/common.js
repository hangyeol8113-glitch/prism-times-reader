export const $ = (s, root=document) => root.querySelector(s);
export const $$ = (s, root=document) => [...root.querySelectorAll(s)];
export function escapeHTML(s) { return String(s).replace(/[&<>"']/g, c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }
export function notify(message) {
  const box = $('#toast');
  if (!box) return;
  box.textContent = message; box.classList.add('visible');
  clearTimeout(notify.timer); notify.timer=setTimeout(()=>box.classList.remove('visible'), 4000);
}
export function download(blob, filename) {
  const old=document.getElementById('file-download-dialog');if(old)old.remove();
  const url=URL.createObjectURL(blob);const dialog=document.createElement('dialog');dialog.id='file-download-dialog';dialog.className='file-download-dialog';
  const title=document.createElement('h2');title.textContent='파일이 준비되었습니다';
  const name=document.createElement('p');name.textContent=filename;
  const a=document.createElement('a');a.href=url;a.download=filename;a.className='primary-button';a.textContent='파일 저장';
  const note=document.createElement('p');note.className='tiny-note';note.textContent='저장 버튼을 눌러 이 기기에 보관하세요.';
  const close=document.createElement('button');close.type='button';close.className='file-dialog-close';close.textContent='닫기';close.onclick=()=>dialog.close();
  dialog.append(title,name,a,note,close);document.body.append(dialog);dialog.addEventListener('close',()=>{URL.revokeObjectURL(url);dialog.remove();},{once:true});dialog.showModal();
}
export function qrSVG(value) {
  const qr=window.qrcode(0,'M'); qr.addData(value); qr.make();
  const n=qr.getModuleCount(); const q=4; let d='';
  for(let y=0;y<n;y++) for(let x=0;x<n;x++) if(qr.isDark(y,x)) d+=`M${x+q},${y+q}h1v1h-1z`;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${n+q*2} ${n+q*2}" width="600" height="600" shape-rendering="crispEdges"><rect width="100%" height="100%" fill="white"/><path d="${d}" fill="#111111"/></svg>`;
}
export async function copyText(value) {
  try { await navigator.clipboard.writeText(value); }
  catch { const t=document.createElement('textarea');t.value=value;t.style.position='fixed';t.style.opacity='0';document.body.append(t);t.select();const ok=document.execCommand('copy');t.remove();if(!ok) throw new Error('링크를 직접 선택해 복사해 주세요.'); }
}
export async function openDraftDB() {
  return new Promise((resolve,reject)=>{const r=indexedDB.open('prism-reader-drafts',1);r.onupgradeneeded=()=>r.result.createObjectStore('drafts',{keyPath:'id'});r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error);});
}
export async function draftAction(method, value) {
  const db=await openDraftDB();
  try{return await new Promise((resolve,reject)=>{const tx=db.transaction('drafts',method==='get'||method==='getAll'?'readonly':'readwrite');let result;const r=tx.objectStore('drafts')[method](...(value===undefined?[]:[value]));r.onsuccess=()=>{result=r.result;};tx.oncomplete=()=>resolve(result);tx.onerror=()=>reject(tx.error);tx.onabort=()=>reject(tx.error);});} finally{db.close();}
}
