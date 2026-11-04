import {build} from 'esbuild';
import {readdir,readFile,writeFile,mkdir} from 'node:fs/promises';
import {resolve,relative} from 'node:path';
import {fileURLToPath} from 'node:url';
import {zipSync,strToU8} from 'fflate';
const root=fileURLToPath(new URL('..',import.meta.url));
await mkdir(resolve(root,'dist'),{recursive:true});
await build({entryPoints:[resolve(root,'worker.mjs')],bundle:true,format:'esm',platform:'browser',loader:{'.html':'text'},outfile:resolve(root,'dist/worker.js'),minify:true});
const files={};
for(const name of ['package.json','package-lock.json','README.md','OPERATIONS-FREE.md','worker.mjs','reader-template.html','admin-template.html','wrangler.example.json','.gitignore']){try{files[name]=new Uint8Array(await readFile(resolve(root,name)));}catch(e){if(e.code!=='ENOENT')throw e;}}
async function visit(folder){for(const entry of await readdir(folder,{withFileTypes:true})){const path=resolve(folder,entry.name);if(entry.isDirectory())await visit(path);else if(entry.isFile()&&!/\.(pdf|zip)$/.test(entry.name)&&!entry.name.startsWith('.env')&&!entry.name.startsWith('.dev.vars'))files[relative(root,path).replaceAll('\\','/')]=new Uint8Array(await readFile(path));}}
for(const d of ['server','data','migrations','scripts','tests','public'])await visit(resolve(root,d));
files['SOURCE-INFO.txt']=strToU8('This source deploys directly to your Cloudflare account. ChatGPT and OpenAI runtime services are not required. PDFs, credentials, deployment account IDs and live data are excluded. Restore live PDFs and metadata from a management backup.\n');
await writeFile(resolve(root,'public/handover-source.zip'),zipSync(files,{level:6}));
console.log('Standalone Worker and portable source backup built. No ChatGPT runtime dependency.');
