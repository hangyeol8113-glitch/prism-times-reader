// File previews stay in the browser until the administrator saves the PDF.
export function installFiles({$,api,busy,notify,pdfjs,size,date,esc,saveBlob}){
 let documentPDF=null,previewPage=1,previewToken=0,manifest=null,downloading=false;
 const dialog=$('#pdf-preview-dialog'),canvas=$('#pdf-preview-canvas');
 async function renderPage(token){
  if(!documentPDF)return;const page=await documentPDF.getPage(previewPage);if(token!==previewToken)return;
  const viewport=page.getViewport({scale:Math.min(1600/page.getViewport({scale:1}).width,2.5)}),paper=document.createElement('canvas');paper.width=Math.round(viewport.width);paper.height=Math.round(viewport.height);
  await page.render({canvasContext:paper.getContext('2d'),viewport}).promise;if(token!==previewToken){paper.width=paper.height=0;return;}
  canvas.width=paper.width;canvas.height=paper.height;canvas.getContext('2d').drawImage(paper,0,0);paper.width=paper.height=0;canvas.setAttribute('aria-label',previewPage+'쪽 PDF 미리보기');
  $('#pdf-preview-page').textContent=previewPage+' / '+documentPDF.numPages;$('#pdf-preview-prev').disabled=previewPage<=1;$('#pdf-preview-next').disabled=previewPage>=documentPDF.numPages;
 }
 async function openPreview({file,version,title}){
  const token=++previewToken;$('#pdf-preview-title').textContent=title||file?.name||'신문 PDF 미리보기';$('#pdf-preview-status').textContent='PDF를 불러오고 있습니다…';canvas.hidden=true;$('#pdf-preview-prev').disabled=$('#pdf-preview-next').disabled=true;$('#pdf-preview-page').textContent='';
  // showModal adds this dialog above the still-open registration/version dialog.
  if(!dialog.open)dialog.showModal();
  try{
   const input=file?{data:new Uint8Array(await file.arrayBuffer())}:{url:'/api/prism/files/'+encodeURIComponent(version)};
   const next=await pdfjs.getDocument({...input,cMapUrl:'/vendor/cmaps/',cMapPacked:true,standardFontDataUrl:'/vendor/standard_fonts/'}).promise;
   if(token!==previewToken){await next.destroy();return;}if(documentPDF)await documentPDF.destroy();documentPDF=next;previewPage=1;await renderPage(token);
   if(token===previewToken){canvas.hidden=false;$('#pdf-preview-status').textContent='';}
  }catch(error){if(token===previewToken)$('#pdf-preview-status').textContent='미리보기를 열지 못했습니다. '+error.message;}
 }
 dialog.addEventListener('close',()=>{previewToken++;const old=documentPDF;documentPDF=null;canvas.width=canvas.height=0;if(old)old.destroy().catch(()=>{});});
 for(const [id,step] of [['pdf-preview-prev',-1],['pdf-preview-next',1]])$( '#'+id).onclick=e=>busy(e.currentTarget,async()=>{if(!documentPDF)return;previewPage=Math.max(1,Math.min(documentPDF.numPages,previewPage+step));await renderPage(++previewToken);});
 $('#edition-file').addEventListener('change',()=>{$('#selected-pdf-preview').disabled=!$('#edition-file').files.length;});
 $('#selected-pdf-preview').onclick=()=>{const file=$('#edition-file').files[0];if(file)openPreview({file});};
 document.addEventListener('click',e=>{const link=e.target.closest('a[href]');if(!link)return;const u=new URL(link.href,location.href),version=u.searchParams.get('preview');if(u.origin!==location.origin||!version)return;e.preventDefault();openPreview({version,title:link.closest('.edition-card')?.querySelector('h3')?.textContent||'저장된 PDF 미리보기'});});
 function selection(){const count=$('#paper-files').querySelectorAll('input:checked').length;$('#papers-selected').disabled=downloading||!count;$('#papers-selected').textContent='선택한 파일 다운로드'+(count?' · '+count+'개':'');}
 async function loadPapers(){
  const list=$('#paper-files');list.textContent='PDF 목록을 불러오고 있습니다…';manifest=await api('admin/backup');
  list.innerHTML=manifest.versions.map(v=>{const e=manifest.editions.find(e=>e.id===v.edition_id);const state=e?.deleted_at?'휴지통':e?.current_version===v.id?'현재 게시본':e?.pending_version===v.id?'게시 대기':'이전 수정본';return `<label class="paper-file"><input type="checkbox" value="${esc(v.id)}"><span><strong>${esc(v.filename)}</strong><small>${esc(e?.label||v.edition_id)} · ${state} · ${v.page_count}쪽 · ${size(v.size)} · ${date(v.created_at)}</small></span><button class="secondary" type="button" data-paper-download="${esc(v.id)}">PDF 다운로드</button></label>`;}).join('')||'<p class="muted">저장된 PDF 파일이 없습니다.</p>';
  $('#papers-all').disabled=downloading||!manifest.versions.length;selection();$('#paper-download-status').textContent=manifest.versions.length+'개 PDF · 수정본과 휴지통 파일 포함';
 }
 function safeName(name){return String(name).replace(/[\\/:*?"<>|\x00-\x1f]/g,'_').replace(/^\.+/,'_')||'신문.pdf';}
 async function downloadPapers(ids,all=false){
  if(downloading||!manifest)return;const files=manifest.versions.filter(v=>all||ids.includes(v.id));if(!files.length)return;
  downloading=true;for(const b of document.querySelectorAll('[data-paper-download],#papers-selected,#papers-all,#papers-refresh'))b.disabled=true;
  const status=$('#paper-download-status');
  try{
   // A single selection retains its original PDF filename; groups contain PDFs only.
   if(files.length===1&&!all){const file=files[0];status.textContent=file.filename+' 다운로드 중…';const r=await fetch(file.url,{credentials:'same-origin'});if(!r.ok)throw Error('파일을 내려받지 못했습니다. 목록을 새로고침해 주세요.');const blob=await r.blob();if(blob.size!==file.size)throw Error('파일 크기가 맞지 않습니다. 다시 시도해 주세요.');saveBlob(blob,safeName(file.filename));}
   else{
    const chunks=[];let zipError;const zip=new fflate.Zip((error,chunk)=>{if(error)zipError=error;else chunks.push(chunk);});
    for(let i=0;i<files.length;i++){const file=files[i];status.textContent=`PDF ${i+1}/${files.length}개 다운로드 중 · ${file.filename}`;const r=await fetch(file.url,{credentials:'same-origin'});if(!r.ok||!r.body)throw Error(file.filename+'을 내려받지 못했습니다.');const entry=new fflate.ZipPassThrough(safeName(file.edition_id)+'/'+file.id+'-'+safeName(file.filename));zip.add(entry);const reader=r.body.getReader();let received=0;try{while(true){const {done,value}=await reader.read();if(done)break;received+=value.byteLength;entry.push(value,false);if(zipError)throw zipError;}if(received!==file.size)throw Error(file.filename+' 크기가 맞지 않습니다.');entry.push(new Uint8Array(),true);}finally{reader.releaseLock();}}
    zip.end();if(zipError)throw zipError;saveBlob(new Blob(chunks,{type:'application/zip'}),'PRISM-TIMES-PDF-'+(all?'전체':'선택')+'-'+new Date().toISOString().slice(0,10)+'.zip');
   }
   status.textContent=files.length+'개 PDF 다운로드를 시작했습니다. 다운로드 폴더를 확인해 주세요.';
  }catch(error){status.textContent=error.message;notify(error.message);}finally{downloading=false;for(const b of document.querySelectorAll('[data-paper-download],#papers-refresh'))b.disabled=false;$('#papers-all').disabled=!manifest.versions.length;selection();}
 }
 $('#paper-files').addEventListener('change',selection);
 $('#paper-files').addEventListener('click',e=>{const b=e.target.closest('[data-paper-download]');if(b){e.preventDefault();downloadPapers([b.dataset.paperDownload]);}});
 $('#papers-refresh').onclick=e=>busy(e.currentTarget,loadPapers);
 $('#papers-selected').onclick=()=>downloadPapers([...$('#paper-files').querySelectorAll('input:checked')].map(input=>input.value));
 $('#papers-all').onclick=()=>downloadPapers([],true);
 return {loadPapers};
}
