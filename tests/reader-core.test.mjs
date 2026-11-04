import test from 'node:test';
import assert from 'node:assert/strict';
import {resolveRoute,pageLink,mergeEditions} from '../public/reader-core.js';
const config={defaultIssue:'2026-01',editions:[{id:'2026-01',pdf:'papers/2026-01.pdf'},{id:'2027-01',pdf:'papers/2027-01.pdf'}]};
test('printed links retain their issue after the default changes',()=>{const changed={...config,defaultIssue:'2027-01'};const route=resolveRoute('?issue=2026-01&page=7',changed,16);assert.equal(route.issue.id,'2026-01');assert.equal(route.page,7);assert.equal(resolveRoute('',changed,16).issue.id,'2027-01');});
test('all sixteen pages can be addressed directly',()=>{for(let p=1;p<=16;p++)assert.equal(resolveRoute('?issue=2026-01&page='+p,config,16).page,p);});
test('unknown issues do not silently open another newspaper',()=>assert.equal(resolveRoute('?issue=missing&page=3',config,16).error,'issue'));
test('invalid page inputs are bounded and reported',()=>{for(const [input,result] of [['0',1],['-1',1],['17',16],['NaN',1],['2.2',1],['9007199254740993',1]]){const r=resolveRoute('?page='+input,config,16);assert.equal(r.page,result);assert.ok(r.corrected);}});
test('shared links remove device previews and retain path prefixes',()=>{const u=new URL(pageLink('https://example.test/newspaper/?draft=local#abc','2026-01',16));assert.equal(u.pathname,'/newspaper/');assert.deepEqual([...u.searchParams],[['issue','2026-01'],['page','16']]);assert.equal(u.hash,'');});
test('new publications preserve old real editions and remove demonstration editions',()=>{const old={...config,editions:[...config.editions,{id:'preview',isDemo:true}]};const merged=mergeEditions(old,[{id:'2028-01',title:'new',label:'2028',pageCount:16}],'2028-01');assert.deepEqual(merged.editions.map(x=>x.id),['2026-01','2027-01','2028-01']);assert.equal(merged.defaultIssue,'2028-01');assert.equal(merged.editions[0].pdf,'papers/2026-01.pdf');});
test('publishing cannot replace an existing issue by accident',()=>assert.throws(()=>mergeEditions(config,[{id:'2026-01'}],'2026-01'),/기존 호/));
test('a default must point to an edition that exists in the publication bundle',()=>assert.throws(()=>mergeEditions(config,[],'missing'),/기본/));

test('removed QR links show deletion instead of opening the new default',()=>{const c={...config,removedIssueIds:['2025-01']};assert.equal(resolveRoute('?issue=2025-01&page=4',c,16).error,'deleted');assert.equal(resolveRoute('?issue=2025-01&page=4',c,16).issue,undefined);});
test('a reader with no published newspaper has an explicit empty state',()=>{assert.equal(resolveRoute('',{defaultIssue:'',editions:[],removedIssueIds:[]}).error,'empty');assert.equal(resolveRoute('?issue=unknown',{defaultIssue:'',editions:[]}).error,'issue');});

test('published issues without a selected default still open by their QR',()=>{const c={...config,defaultIssue:''};assert.equal(resolveRoute('',c,16).error,'no-default');assert.equal(resolveRoute('?issue=2026-01&page=4',c,16).page,4);});
