import test from 'node:test';
import assert from 'node:assert/strict';
import qrcode from 'qrcode-generator';
import {zipSync,unzipSync,strToU8,strFromU8} from 'fflate';
import {qrSVG} from '../public/common.js';
import {pageLink} from '../public/reader-core.js';
globalThis.window={qrcode};
test('sixteen printable QR files survive a complete ZIP round trip',()=>{
  const files={},rows=['issue,page,url'];
  for(let p=1;p<=16;p++){
    const url=pageLink('https://newspaper.example/reader/','2026-01',p);
    const svg=qrSVG(url);assert.match(svg,/viewBox="0 0 \d+ \d+"/);assert.match(svg,/fill="white"/);
    files[`page-${p}.svg`]=strToU8(svg);rows.push(`2026-01,${p},${url}`);
  }
  files['links.csv']=strToU8(rows.join('\n'));const unpacked=unzipSync(zipSync(files));assert.equal(Object.keys(unpacked).length,17);
  assert.equal(strFromU8(unpacked['links.csv']).split('\n').length,17);
  assert.match(strFromU8(unpacked['page-16.svg']),/<svg/);
});
