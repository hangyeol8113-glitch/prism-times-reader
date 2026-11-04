import * as pdfjs from './vendor/pdf.mjs';
import {$,$$,notify,draftAction,escapeHTML} from './common.js';
import {resolveRoute,pageLink} from './reader-core.js';
pdfjs.GlobalWorkerOptions.workerSrc=new URL('./vendor/pdf.worker.mjs',import.meta.url).href;
const state={pdf:null,issue:null,config:null,count:0,page:1,flip:null,spread:false,draft:false,suppressFlip:false,turning:false,turnPhase:'read',mountVersion:0,navigationHistoryPush:null,pageSources:new Map(),rendered:new Map(),thumbs:new Map(),queue:Promise.resolve(),zoom:1};
let bookRatio=1/Math.SQRT2;
const ready = document.readyState === 'loading' ? new Promise(r=>document.addEventListener('DOMContentLoaded',r,{once:true})) : Promise.resolve();
await ready;
function fail(title,message){$('#loading').hidden=true;$('#error').hidden=false;$('#error-title').textContent=title;$('#error-message').textContent=message;$$('.reader-toolbar button,.edge-nav').forEach(b=>b.disabled=true);$('#page-input').disabled=true;}
function pdfOptions(extra){return {cMapUrl:new URL('./vendor/cmaps/',import.meta.url).href,cMapPacked:true,standardFontDataUrl:new URL('./vendor/standard_fonts/',import.meta.url).href,...extra};}
async function boot(){
  try{
    const response=await fetch(window.PRISM_BACKEND_URL?new URL('/editions.json',window.PRISM_BACKEND_URL):new URL('./editions.json',import.meta.url));if(!response.ok)throw new Error('발행 정보를 불러오지 못했습니다.');state.config=await response.json();
    const params=new URLSearchParams(location.search);const draftId=params.get('draft');const previewId=params.get('preview');let input;
    if(previewId){const r=await fetch('/api/prism/admin/preview/'+encodeURIComponent(previewId));if(!r.ok){fail('관리자 로그인이 필요합니다','관리실에서 로그인한 후 미리보기를 다시 열어 주세요.');return;}state.issue=await r.json();state.draft=true;state.previewId=previewId;input={url:new URL(state.issue.pdf,location.href).href};}
    else if(draftId){const d=await draftAction('get',draftId);if(!d){fail('이 기기에 미리보기 파일이 없습니다','발행 준비 화면에서 PDF를 먼저 저장해 주세요. 기기 미리보기 링크는 다른 사람과 공유할 수 없습니다.');return;}state.issue={...d,isDemo:false};state.draft=true;input={data:new Uint8Array(d.bytes.slice(0))};}
    else{const route=resolveRoute(location.search,state.config);if(route.error){
      const failures={
        deleted:['관리자가 삭제한 신문입니다','이 신문은 현재 공개되어 있지 않습니다. 관리자가 복원하면 기존 QR로 다시 볼 수 있습니다.'],
        empty:['아직 게시된 신문이 없습니다','관리자가 신문을 게시하면 이곳에서 바로 볼 수 있습니다.'],
        'no-default':['기본으로 열 신문이 아직 설정되지 않았습니다','관리자가 기본 신문을 선택하면 이곳에서 바로 볼 수 있습니다. 각 호의 QR로도 접속할 수 있습니다.'],
        issue:['해당 발행 호를 찾을 수 없습니다','주소에 지정된 신문이 등록되어 있지 않습니다. 인쇄물의 호수와 링크를 확인해 주세요.']
      };const [title,message]=failures[route.error]||failures.issue;
      $('#issue-title').textContent=title;$('#issue-label').textContent='PRISM-TIMES';document.title=title+' · PRISM-TIMES';fail(title,message);return;
    }state.issue=route.issue;input={url:new URL(state.issue.pdf,new URL('./',import.meta.url)).href};}
    $('#issue-title').textContent=state.issue.title;$('#issue-label').textContent=state.issue.label;document.title=state.issue.title+' · PRISM-TIMES';
    const tag=$('#demo-tag');if(state.draft){tag.textContent=state.previewId?'관리자 PDF 미리보기':'이 기기의 PDF 미리보기';tag.hidden=false;$('#room-note').textContent='아직 게시되지 않은 신문입니다';}
    else if(state.issue.isDemo){tag.textContent=state.issue.sampleNotice||'예시 '+state.count+'쪽 · 실제 원고 연결 전';tag.hidden=false;$('#room-note').textContent='예시 신문으로 북뷰어를 체험해 보세요';}
    if(state.issue.language==='en'){$('.language-mark').textContent=state.issue.isDemo?'SAMPLE EDITION':'ENGLISH EDITION';$('.language-pill').textContent=state.issue.isDemo?'영어판 예시':'영어판';}
    state.pdf=await pdfjs.getDocument(pdfOptions(input)).promise;state.count=state.pdf.numPages;
    if(state.issue.isDemo&&!state.issue.sampleNotice&&!state.draft)tag.textContent='예시 '+state.count+'쪽 · 실제 원고 연결 전';
    const tempConfig={defaultIssue:state.issue.id,editions:[state.issue]};const route=resolveRoute('?issue='+encodeURIComponent(state.issue.id)+'&page='+(params.get('page')||'1'),tempConfig,state.count);state.page=route.page;
    $('#page-total').textContent=state.count;$('#page-input').max=state.count;
    const first=await state.pdf.getPage(1);const vp=first.getViewport({scale:1});bookRatio=vp.width/vp.height;
    if(window.innerWidth<760)state.spread=false;
    await mountBook();updateUI();buildContents();updateAddress(false);
    $('#loading').hidden=true;
    if(route.corrected)notify('페이지 번호를 확인해 '+state.page+'쪽을 열었습니다.');
  }catch(error){console.error(error);fail('신문을 불러오지 못했습니다','PDF 파일을 읽을 수 없습니다. 파일 경로와 네트워크 연결을 확인한 뒤 다시 열어 주세요.');}
}
function getBookSize(){
  const room=$('#reading-room');const isMobile=innerWidth<760;const spread=state.spread&&!isMobile;
  document.body.classList.toggle('spread-reading',spread);
  const availableHeight=room.clientHeight-(isMobile?8:spread?16:62);const availableWidth=room.clientWidth-(isMobile?36:spread?104:170);
  const width=Math.floor(Math.min(availableHeight*bookRatio,availableWidth/(spread?2:1),spread?Infinity:600));
  return{width:Math.max(100,width),height:Math.max(140,Math.floor(width/bookRatio)),spread};
}
async function mountBook(){
  const {width,height,spread}=getBookSize();const mountVersion=++state.mountVersion;state.suppressFlip=true;state.navigationHistoryPush=null;setTurnState('preparing');
  if(state.flip){state.flip.destroy();state.flip=null;}
  state.rendered.clear();
  const slot=$('#book-slot');slot.style.width=width*(spread?2:1)+'px';slot.style.height=height+'px';slot.classList.toggle('spread',spread);
  const root=document.createElement('div');root.id='book';slot.replaceChildren(root);
  for(let p=1;p<=state.count;p++){const el=document.createElement('div');el.className='page';el.dataset.page=String(p);el.setAttribute('aria-label',p+'쪽');el.innerHTML='<div class="page-loading">'+String(p).padStart(2,'0')+'</div><canvas aria-label="'+p+'쪽 신문"></canvas>';root.append(el);}
  // Corner-only filtering also rejects flipPrev()'s visible-left start point
  // in portrait mode. Allow the engine's normal click and swipe handling.
  state.flip=new window.St.PageFlip(root,{width,height,size:'fixed',minWidth:width,maxWidth:width,minHeight:height,maxHeight:height,usePortrait:!spread,autoSize:false,showCover:false,startPage:state.page-1,flippingTime:matchMedia('(prefers-reduced-motion:reduce)').matches?1:500,drawShadow:true,maxShadowOpacity:.18,mobileScrollSupport:false,useMouseEvents:true,swipeDistance:35,clickEventForward:false,disableFlipByClick:false});
  const engine=state.flip;
  engine.on('flip',e=>{if(engine!==state.flip||state.suppressFlip)return;state.page=Math.min(state.count,e.data+1);updateUI();updateAddress(state.navigationHistoryPush??true);state.navigationHistoryPush=null;renderNearby();});
  engine.on('changeState',e=>{if(engine===state.flip)setTurnState(e.data);});
  state.flip.loadFromHTML(root.querySelectorAll('.page'));
  state.flip.turnToPage(state.page-1);
  await renderPage(state.page);if(spread)await renderPage(state.page%2===0?state.page-1:state.page+1);
  if(mountVersion!==state.mountVersion)return;state.suppressFlip=false;setTurnState('read');renderNearby();
}
function setTurnState(phase){
  state.turnPhase=phase;
  state.turning=['preparing','flipping','user_fold'].includes(phase);
  $('#book-slot').dataset.turnState=phase;
  $('#reading-room').setAttribute('aria-busy',String(state.turning));
  updateUI();
}
function pageSource(p){
  if(state.pageSources.has(p))return state.pageSources.get(p);
  const promise=(async()=>{const page=await state.pdf.getPage(p);const vp=page.getViewport({scale:1});const scale=Math.min(1800/vp.width,2.5);const viewport=page.getViewport({scale});const canvas=document.createElement('canvas');canvas.width=Math.round(viewport.width);canvas.height=Math.round(viewport.height);await page.render({canvasContext:canvas.getContext('2d'),viewport}).promise;const blob=await new Promise(resolve=>canvas.toBlob(resolve,'image/jpeg',.94));canvas.width=0;canvas.height=0;if(!blob)throw new Error('페이지 이미지를 만들지 못했습니다.');return URL.createObjectURL(blob);})();
  state.pageSources.set(p,promise);promise.catch(()=>{if(state.pageSources.get(p)===promise)state.pageSources.delete(p);});return promise;
}
async function renderPage(p){
  if(p<1||p>state.count)return;
  const canvas=$('#book .page[data-page="'+p+'"] canvas');if(!canvas)return;
  if(state.rendered.has(p))return state.rendered.get(p);
  const promise=(async()=>{const url=await pageSource(p);if(!canvas.isConnected)return;
    // StPageFlip clones pages during portrait turns; cloning a canvas drops
    // its bitmap. An image preserves the newspaper in both turning directions.
    // Reuse the same source across rotations and spread changes, rather than
    // re-rendering a PDF page for each layout.
    const image=document.createElement('img');image.alt=p+'쪽 신문';image.draggable=false;image.src=url;await image.decode();if(!canvas.isConnected)return;const paper=canvas.parentElement;canvas.replaceWith(image);paper.classList.add('ready');})();
  state.rendered.set(p,promise);return promise;
}
function renderNearby(){
  const next=[state.page-1,state.page+1,state.page+2,state.page-2];
  for(const p of next)state.queue=state.queue.then(()=>renderPage(p)).catch(e=>console.warn('Page preview',e));
}
function updateUI(){
  const spreadStart=Math.floor((state.page-1)/2)*2+1;
  // A disabled arrow can swallow mouseup when a drag ends over it. Keep the
  // pointer's release path live during a fold; move() still serializes turns.
  const navigationBusy=['preparing','flipping'].includes(state.turnPhase);
  $('#page-input').value=state.page;$('#prev').disabled=navigationBusy||(state.spread?spreadStart===1:state.page<=1);$('#next').disabled=navigationBusy||(state.spread?spreadStart+1>=state.count:state.page>=state.count);
  $('#page-input').disabled=state.turning;$('#contents').disabled=state.turning;$('#spread').disabled=state.turning;
  $('#page-caption').textContent=state.issue.sections?.[state.page-1]||state.page+'쪽';
  $('#spread').setAttribute('aria-pressed',String(state.spread));$('#spread').setAttribute('aria-label',state.spread?'한 쪽 보기로 전환':'두 쪽 펼침으로 전환');$('#spread-text').textContent=state.spread?'한 쪽':'펼침';
  $$('.thumbnail-button').forEach(b=>{const active=Number(b.dataset.page)===state.page;b.classList.toggle('active',active);if(active)b.setAttribute('aria-current','page');else b.removeAttribute('aria-current');});
}
function updateAddress(push){
  const url=state.draft?new URL(location.href):new URL(pageLink(location.href,state.issue.id,state.page));
  if(state.draft){url.search='';url.searchParams.set(state.previewId?'preview':'draft',state.previewId||state.issue.id);url.searchParams.set('page',String(state.page));}
  if(url.href===location.href)return;
  if(push)history.pushState({},'',url);else history.replaceState({},'',url);
}
async function goTo(p,{animate=false,push=true}={}){
  if(!state.pdf||state.turning)return;
  p=Math.min(state.count,Math.max(1,Number(p)||1));p=Math.round(p);
  if(p===state.page)return;
  const engine=state.flip;setTurnState('preparing');
  try{
    await renderPage(p);if(state.spread)await renderPage(p%2===0?p-1:p+1);
    if(engine!==state.flip)return;
    if(animate){
      // Start after a fresh render tick so PDF preparation cannot consume the
      // animation's clock before its first visible frame.
      await new Promise(resolve=>requestAnimationFrame(resolve));if(engine!==state.flip)return;
      state.navigationHistoryPush=push;
      // Adjacent turns keep the engine's spread index intact. Commit the page
      // and URL only when its real flip event reports the completed turn.
      if(p-1<engine.getCurrentPageIndex())engine.flipPrev();else engine.flipNext();
      if(engine.getState()!=='flipping'){state.navigationHistoryPush=null;setTurnState('read');}
    }else{
      state.suppressFlip=true;engine.turnToPage(p-1);state.page=p;state.suppressFlip=false;setTurnState('read');if(push)updateAddress(true);renderNearby();
    }
  }catch(error){console.error(error);if(engine===state.flip){state.suppressFlip=false;state.navigationHistoryPush=null;setTurnState('read');notify('페이지를 열지 못했습니다. 다시 시도해 주세요.');}}
}
function move(direction){if(state.turning)return;const spread=state.spread&&innerWidth>=760;const start=spread?Math.floor((state.page-1)/2)*2+1:state.page;goTo(start+direction*(spread?2:1),{animate:true});}
$('#prev').addEventListener('click',()=>move(-1));$('#next').addEventListener('click',()=>move(1));
$('#page-form').addEventListener('submit',e=>{e.preventDefault();const p=Number($('#page-input').value);if(!Number.isInteger(p)||p<1||p>state.count){notify('1부터 '+state.count+'까지의 쪽수를 입력해 주세요.');$('#page-input').value=state.page;return;}goTo(p);$('#page-input').blur();});
$('#spread').addEventListener('click',async()=>{state.spread=!state.spread;await mountBook();updateUI();});
document.addEventListener('keydown',e=>{if($('dialog[open]')||['INPUT','TEXTAREA','SELECT'].includes(document.activeElement.tagName)||e.ctrlKey||e.metaKey||e.altKey)return;if(e.key==='ArrowRight'){e.preventDefault();move(1);}if(e.key==='ArrowLeft'){e.preventDefault();move(-1);}});
window.addEventListener('popstate',()=>{const q=new URLSearchParams(location.search);if((q.get('issue')||state.config.defaultIssue)!==state.issue.id&&!state.draft){location.reload();return;}goTo(Number(q.get('page'))||1,{push:false});});
let resizeTimer;window.addEventListener('resize',()=>{clearTimeout(resizeTimer);resizeTimer=setTimeout(async()=>{if(!state.pdf)return;if(innerWidth<760)state.spread=false;await mountBook();updateUI();},200);});
function buildContents(){
  const grid=$('#thumbnail-grid');grid.innerHTML='';
  for(let p=1;p<=state.count;p++){const button=document.createElement('button');button.className='thumbnail-button';button.dataset.page=p;const name=state.issue.sections?.[p-1]||'신문 '+p+'쪽';button.setAttribute('aria-label',p+'쪽 '+name);button.innerHTML='<div class="thumbnail-paper"><span class="thumbnail-number">'+String(p).padStart(2,'0')+'</span><canvas aria-hidden="true"></canvas></div><span class="thumbnail-caption"><b>'+String(p).padStart(2,'0')+'</b><span>'+escapeHTML(name)+'</span></span>';button.onclick=()=>{goTo(p);$('#contents-dialog').close();};grid.append(button);}
  updateUI();
}
const thumbObserver=new IntersectionObserver(entries=>{for(const e of entries){if(!e.isIntersecting)continue;const p=Number(e.target.dataset.page);thumbObserver.unobserve(e.target);state.queue=state.queue.then(async()=>{if(state.thumbs.has(p))return;state.thumbs.set(p,true);const canvas=$('canvas',e.target);const page=await state.pdf.getPage(p);const base=page.getViewport({scale:1});const viewport=page.getViewport({scale:280/base.width});canvas.width=Math.round(viewport.width);canvas.height=Math.round(viewport.height);await page.render({canvasContext:canvas.getContext('2d'),viewport}).promise;canvas.parentElement.classList.add('ready');}).catch(e=>console.warn(e));}},{root:$('#contents-dialog'),rootMargin:'80px'});
$('#contents').onclick=()=>{$('#contents-dialog').showModal();$$('.thumbnail-button').forEach(b=>thumbObserver.observe(b));};
$$('.close-dialog').forEach(b=>b.onclick=()=>b.closest('dialog').close());
$$('dialog').forEach(d=>d.addEventListener('click',e=>{if(e.target===d){const r=d.getBoundingClientRect();if(e.clientX<r.left||e.clientX>r.right||e.clientY<r.top||e.clientY>r.bottom)d.close();}}));
$('#fullscreen').onclick=async()=>{try{if(document.fullscreenElement)await document.exitFullscreen();else if(document.documentElement.requestFullscreen)await document.documentElement.requestFullscreen();else notify('이 브라우저에서는 전체 화면을 지원하지 않습니다.');}catch{notify('전체 화면을 열 수 없습니다.');}};
async function renderZoom(){
  const canvas=$('#zoom-canvas');const pdfPage=await state.pdf.getPage(state.page);const vp=pdfPage.getViewport({scale:1});const viewport=pdfPage.getViewport({scale:Math.min(2500/vp.width,4)});canvas.width=Math.round(viewport.width);canvas.height=Math.round(viewport.height);await pdfPage.render({canvasContext:canvas.getContext('2d'),viewport}).promise;sizeZoom();
}
function sizeZoom(){const w=Math.min($('#zoom-scroll').clientWidth-30,900)*state.zoom;$('#zoom-canvas').style.width=w+'px';$('#zoom-canvas').style.height='auto';$('#zoom-percent').textContent=Math.round(state.zoom*100)+'%';$('#zoom-minus').disabled=state.zoom<=1;$('#zoom-plus').disabled=state.zoom>=3;}
$('#zoom').onclick=async()=>{if(!state.pdf)return;state.zoom=1;$('#zoom-title').textContent=state.page+'쪽 확대 보기';$('#zoom-dialog').showModal();$('#zoom-scroll').scrollTo(0,0);await renderZoom();};
$('#zoom-minus').onclick=()=>{state.zoom=Math.max(1,state.zoom-.25);sizeZoom();};$('#zoom-plus').onclick=()=>{state.zoom=Math.min(3,state.zoom+.25);sizeZoom();};
await boot();
