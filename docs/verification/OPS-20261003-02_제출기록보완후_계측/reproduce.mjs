// Run from the app Git repository root. Synthetic in-memory PGlite only.
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import {gunzipSync} from 'node:zlib';
import {spawnSync} from 'node:child_process';
const dir=path.dirname(fileURLToPath(import.meta.url));
const manifest=JSON.parse(fs.readFileSync(path.join(dir,'재현명세와_인원가정.json'),'utf8'));
const hash=b=>createHash('sha256').update(b).digest('hex');
const expectedMigrations=manifest.sourceInputs.map(x=>x.source).filter(x=>x.startsWith('supabase/migrations/')&&x.endsWith('.sql')).sort();
const currentMigrations=fs.readdirSync('supabase/migrations').filter(x=>x.endsWith('.sql')).map(x=>'supabase/migrations/'+x).sort();
if(JSON.stringify(expectedMigrations)!==JSON.stringify(currentMigrations))throw Error('Migration file set changed; this baseline must run with its recorded schema.');
for(const input of manifest.sourceInputs){const bytes=fs.readFileSync(input.source);if(hash(input.comparison==='utf8-lf'?bytes.toString('utf8').replace(/\r\n/g,'\n'):bytes)!==input.comparisonSha256)throw Error('Source changed: '+input.source);}
for(const file of manifest.evidence)if(hash(fs.readFileSync(path.join(dir,file.path)))!==file.sha256)throw Error('Evidence changed: '+file.path);
if(hash(gunzipSync(fs.readFileSync(path.join(dir,manifest.rawMeasurement.path))))!==manifest.rawMeasurement.sha256)throw Error('Decompressed evidence mismatch');
if(process.argv.includes('--check-only')){console.log('Source and evidence hashes match. No execution.');process.exit(0);}
const out='.codex-tmp/m09-after-receipt';fs.mkdirSync(out,{recursive:true});
for(const name of ['model.test.ts','config.ts'])fs.copyFileSync(path.join(dir,name+'.txt'),path.join(out,name));
const run=spawnSync(process.execPath,['node_modules/vitest/vitest.mjs','run','--config',path.join(out,'config.ts')],{encoding:'utf8'});
fs.writeFileSync(path.join(out,'rerun.log'),(run.stdout??'')+(run.stderr??''));
process.stdout.write(run.stdout??'');process.stderr.write(run.stderr??'');
if(run.status!==0)process.exit(run.status??1);
const analysis=spawnSync(process.execPath,[path.join(dir,'analyze.mjs')],{stdio:'inherit'});
process.exit(analysis.status??1);
