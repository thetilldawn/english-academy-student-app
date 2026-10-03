// Run from the app repository root. Local synthetic verification only.
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawnSync} from 'node:child_process';
import {createHash} from 'node:crypto';
const here=path.dirname(fileURLToPath(import.meta.url));
const mode=process.argv[2]??'space';
if(!['space','worksheet'].includes(mode))throw Error('Choose space or worksheet');
const target='.codex-tmp/m08-'+(mode==='space'?'space':'combined');
fs.mkdirSync(target,{recursive:true});
if(mode==='space'){
 const inputs=JSON.parse(fs.readFileSync(path.join(here,'input-manifest.json'),'utf8'));
 for(const input of inputs){
  if(createHash('sha256').update(fs.readFileSync(input.source)).digest('hex')!==input.sourceSha256)throw Error('Source changed: '+input.source);
 }
 for(const name of ['measure-factory.ts','config.ts','create-copies.mjs'])fs.copyFileSync(path.join(here,name+(name.endsWith('.ts')?'.txt':'')),path.join(target,name));
 const copied=spawnSync(process.execPath,[path.join(target,'create-copies.mjs')],{stdio:'inherit'});
 if(copied.status!==0)process.exit(copied.status??1);
}else{
 fs.copyFileSync(path.join(here,'worksheet-worksheet.test.ts.txt'),path.join(target,'worksheet.test.ts'));
 fs.copyFileSync(path.join(here,'worksheet-config.ts.txt'),path.join(target,'config.ts'));
}
const result=spawnSync(process.execPath,['node_modules/vitest/vitest.mjs','run','--config',path.join(target,'config.ts')],{encoding:'utf8'});
fs.writeFileSync(path.join(target,'rerun.log'),(result.stdout??'')+(result.stderr??''));
process.stdout.write(result.stdout??'');process.stderr.write(result.stderr??'');
process.exit(result.status??1);
