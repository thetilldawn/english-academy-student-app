import fs from 'node:fs';
import {createHash} from 'node:crypto';
const source='.codex-tmp/m09-after-phase-plan/result.json';
const raw=fs.readFileSync(source);
const r=JSON.parse(raw);
const byName=new Map(r.snapshots.map(s=>[s.label,s]));
const metrics=['row_count','row_text_bytes','row_datum_bytes','heap_main_bytes','table_with_toast_bytes','index_bytes','total_bytes'];
function delta(a,b,runs=1){
 const before=byName.get(a),after=byName.get(b);if(!before||!after)throw new Error('Missing snapshot '+a+' '+b);
 const previous=new Map(before.tables.map(t=>[t.relation_name,t]));
 const tables=after.tables.map(t=>({relation_name:t.relation_name,...Object.fromEntries(metrics.map(k=>[k,t[k]-(previous.get(t.relation_name)?.[k]||0)]))})).filter(t=>metrics.some(k=>t[k]!==0));
 const sum=Object.fromEntries(metrics.map(k=>[k,tables.reduce((n,t)=>n+t[k],0)]));
 const db=after.databaseBytes-before.databaseBytes;
 return {from:a,to:b,runs,databaseBytes:db,tracked:sum,unexplainedDatabaseBytes:db-sum.total_bytes,perRun:Object.fromEntries(metrics.map(k=>[k,sum[k]/runs])),tables:tables.sort((a,b)=>b.row_datum_bytes-a.row_datum_bytes)};
}
const pairs=[['schema','100-students'],['100-students','book-a'],['book-a','run-1-complete'],['run-1-complete','run-2-complete'],['run-2-complete','run-3-complete'],['run-3-complete','run-4-complete'],['run-4-complete','book-b'],['book-b','run-5-complete'],['run-5-complete','run-6-complete'],['run-6-complete','run-6-vacuum'],['run-6-vacuum','run-16-vacuum',10],['run-16-vacuum','run-32-vacuum',16],['run-6-vacuum','run-32-vacuum',26],['run-31-complete','run-32-complete'],['run-32-complete','run-32-vacuum']];
const deltas=pairs.map(p=>delta(...p));
const stable=Array.from({length:26},(_,i)=>delta(i===0?'run-6-vacuum':i===10?'run-16-vacuum':`run-${i+6}-complete`,`run-${i+7}-complete`));
const range=k=>({min:Math.min(...stable.map(x=>x.tracked[k])),max:Math.max(...stable.map(x=>x.tracked[k])),mean:stable.reduce((n,x)=>n+x.tracked[k],0)/stable.length});
const responseFields=['preparedJsonBytes','initialPlanJsonBytes','retryPlanJsonBytes'];
const responseStats=Object.fromEntries(responseFields.map(k=>[k,{min:Math.min(...r.runs.map(x=>x[k])),max:Math.max(...r.runs.map(x=>x[k]))}]));
for(const phase of ['initial','retry'])for(const k of ['requestJsonBytes','responseJsonBytes','localSqlElapsedMs']){const a=r.runs.map(x=>x[phase][k]).sort((a,b)=>a-b);responseStats[phase+'.'+k]={min:a[0],max:a.at(-1),median:a.length%2?a[Math.floor(a.length/2)]:(a[a.length/2-1]+a[a.length/2])/2,p95:a[Math.ceil(a.length*.95)-1],p99:a[Math.ceil(a.length*.99)-1]};}
const totalAppResponse=r.runs.map(x=>x.preparedJsonBytes+x.initialPlanJsonBytes+x.retryPlanJsonBytes+x.initial.responseJsonBytes+x.retry.responseJsonBytes);
responseStats.fiveRpcResponseBytes={min:Math.min(...totalAppResponse),max:Math.max(...totalAppResponse),mean:totalAppResponse.reduce((a,b)=>a+b,0)/totalAppResponse.length};
const out={schemaVersion:'m09-final-schema-analysis-v1',sourceSha256:createHash('sha256').update(raw).digest('hex'),passed:r.passed,startedAt:r.startedAt,finishedAt:r.finishedAt,finalCounts:r.finalCounts,metricNotes:{row_datum_bytes:'sum(pg_column_size(row)); excludes relation pages/index overhead; not physical space projection',row_text_bytes:'sum(octet_length(to_jsonb(row)::text)); verbose row JSON, not HTTP transfer',total_bytes:'sum pg_total_relation_size once per ordinary table incl TOAST and indexes; normal vacuum cadence 6/16/32; not cloud steady state',responses:'Serialized local RPC request/response payload only; API wrapper/session/queue/CDN/audio excluded'},deltas,stableRuns7to32:Object.fromEntries(metrics.map(k=>[k,range(k)])),responseStats};
fs.writeFileSync('.codex-tmp/m09-after-phase-plan/analysis.json',JSON.stringify(out,null,2)+'\n');
console.log(JSON.stringify({sourceSha256:out.sourceSha256,passed:out.passed,finalCounts:out.finalCounts,deltas:deltas.map(({tables,...d})=>d),stable:out.stableRuns7to32,responseStats},null,2));
