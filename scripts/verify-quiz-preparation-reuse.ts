import fs from "node:fs";
import http from "node:http";
import { build } from "esbuild";
import { chromium, expect } from "@playwright/test";

// Real preparation, study hook and IndexedDB. HTTP alone uses three fake words.
async function main() {
  const bundle = (await build({ stdin: { resolveDir: process.cwd(), loader: "tsx", contents: `
import React,{useEffect} from 'react';
import {createRoot} from 'react-dom/client';
import {localFixture,localId} from './src/features/quiz-player/test-support/local-quiz-fixtures';
import {packLocalQuizContents} from './src/features/quiz-player/domain/local-quiz-content';
import {recordLocalAnswer} from './src/features/quiz-player/domain/local-quiz';
import {localAnswerSchema,localBatchSchema} from './src/features/quiz-player/contracts/local-quiz';
import {prepareLocalQuiz,prefetchLocalQuiz} from './src/features/quiz-player/client/flows/local-quiz-preparation';
import {scheduleLocalQuizMaintenance} from './src/features/quiz-player/client/flows/local-quiz-maintenance';
import {useSharedStudy} from './src/features/student-dashboard/controller/use-shared-study';
import {packAssignmentStudy,studyAtomKeys} from './src/features/student-dashboard/domain/study-materials';
import * as store from './src/features/quiz-player/client/flows/local-quiz-store';
const open=()=>new Promise((resolve,reject)=>{const q=indexedDB.open('english-academy-local-quiz-v1',1);q.onupgradeneeded=()=>{for(const table of ['runs','contents','atoms','meta'])q.result.createObjectStore(table,{keyPath:'key'});};q.onsuccess=()=>resolve(q.result);q.onerror=()=>reject(q.error);});
const rawSave=async run=>{const db=await open();await new Promise((resolve,reject)=>{const tx=db.transaction('runs','readwrite');tx.objectStore('runs').put(run);tx.oncomplete=resolve;tx.onabort=()=>reject(tx.error);});db.close();};
window.maintenanceProbe=async()=>{
 const db=await open();await new Promise((resolve,reject)=>{const tx=db.transaction('atoms','readwrite');tx.objectStore('atoms').put({key:'expired-probe',cachedAt:Date.now()-49*3600000});tx.oncomplete=resolve;tx.onabort=()=>reject(tx.error);});
 const present=()=>new Promise((resolve,reject)=>{const q=db.transaction('atoms').objectStore('atoms').get('expired-probe');q.onsuccess=()=>resolve(!!q.result);q.onerror=()=>reject(q.error);});
 let release,acquired;const ready=new Promise(resolve=>acquired=resolve);
 const held=navigator.locks.request('quiz-offline-assets-v1',{mode:'shared'},async()=>{acquired();await new Promise(resolve=>release=resolve);});
 await ready;scheduleLocalQuizMaintenance();await new Promise(resolve=>setTimeout(resolve,5500));const duringExam=await present();
 release();await held;scheduleLocalQuizMaintenance();await new Promise(resolve=>setTimeout(resolve,5500));const afterExam=await present();db.close();
 return {duringExam,afterExam};
};
async function fixture(){const data=await localFixture(3);localStorage.setItem('student-private-cache-identity',data.run.identity);return data;}
async function measured(action){
 const scans=[],cursors=[],rows=[],getAll=IDBObjectStore.prototype.getAll,openCursor=IDBObjectStore.prototype.openCursor;
 IDBObjectStore.prototype.getAll=function(...args){scans.push(this.name);return getAll.apply(this,args);};
 IDBObjectStore.prototype.openCursor=function(...args){const table=this.name;cursors.push(table);const request=openCursor.apply(this,args);request.addEventListener('success',()=>{if(request.result)rows.push(table);});return request;};
 try{return {...await action(),scans,cursors,cursorRows:rows};}finally{IDBObjectStore.prototype.getAll=getAll;IDBObjectStore.prototype.openCursor=openCursor;}
}
window.seedOld=async()=>{
 const {run,contents}=await fixture(),db=await open();db.close();
 await store.cacheLocalQuizContents(await packLocalQuizContents([...contents.values()]));
 const original=recordLocalAnswer({...run,key:localId(900)},0,200,Date.now(),localId(500));
 original.answers.forEach(answer=>localAnswerSchema.parse(answer));await rawSave(original);return JSON.stringify(original);
};
window.prepareProbe=async()=>measured(async()=>{
 const {run,contents}=await fixture(),commands=[],packets=[];
 window.fetch=async(url,init)=>{if(url!='/api/student/local-quiz')throw Error('unexpected URL');const command=JSON.parse(init.body);commands.push(command.action);if(command.action!=='prepare')throw Error('unexpected command');const packet=await packLocalQuizContents([...contents.values()],command.knownKeys);packets.push(packet);return Response.json({...run.preparation,packet});};
 scheduleLocalQuizMaintenance();const href=await prepareLocalQuiz(run.preparation.assignmentId),saved=await store.getLocalQuizRun(href.split('#')[1]);
 const db=await open(),version=db.version;db.close();
 return {href,commands,packetBodies:packets[0].contents.length,packetAtomKeys:packets[0].atoms.map(a=>a.key),stored:JSON.stringify(saved),version};
});
window.seedStudy=async()=>{
 const {run,contents}=await fixture(),values=[...contents.values()];
 const study={assignmentId:run.preparation.assignmentId,title:'가짜 단어 보기',mode:'book_meaning_choice',words:values.map((c,i)=>({key:'word-'+i,headword:c.body.prompt,meaning:'하나',definition:null,example:null,pronunciation:c.body.pronunciation}))};
 const packed=await packAssignmentStudy(study),access={assignmentId:study.assignmentId,studentId:run.studentId,title:study.title,mode:study.mode,revision:'a'.repeat(32)};
 window.fetch=async(url,init)=>{const command=JSON.parse(init.body);if(url!='/api/student/local-quiz'||command.action!=='study')throw Error('unexpected study request');return Response.json({...packed,access});};
 const host=document.createElement('div');document.body.appendChild(host);const root=createRoot(host);
 await new Promise((resolve,reject)=>{function Probe(){const state=useSharedStudy(access);useEffect(()=>{if(state.study)resolve();if(state.error)reject(Error(state.error));},[state.study,state.error]);return null;}root.render(<Probe/>);});
 root.unmount();host.remove();return studyAtomKeys(packed.manifest);
};
window.sharedAndProtected=async()=>{
 const {run,contents,plan}=await fixture(),values=[...contents.values()],packet=await packLocalQuizContents(values),keys=[...contents.keys()];
 let release,requested,hoverSignal;const gate=new Promise(resolve=>release=resolve),started=new Promise(resolve=>requested=resolve),commands=[];
 window.fetch=async(url,init)=>{const command=JSON.parse(init.body);commands.push(command.action);if(url!='/api/student/local-quiz')throw Error('unexpected URL');
  if(command.action==='prefetch'){hoverSignal=init.signal;requested();await gate;init.signal.throwIfAborted();return Response.json({...packet,requiredKeys:keys});}
  return Response.json({...run.preparation,packet:await packLocalQuizContents(values,command.knownKeys)});};
 const hover=new AbortController(),a=new AbortController(),b=new AbortController();
 const warm=prefetchLocalQuiz(run.preparation.assignmentId,hover.signal).catch(e=>e.name);await started;
 const cancelled=prepareLocalQuiz(run.preparation.assignmentId,a.signal).catch(e=>e.name),kept=prepareLocalQuiz(run.preparation.assignmentId,b.signal);
 hover.abort();a.abort();const sharedAlive=!hoverSignal.aborted;release();await kept;await warm;
 const initialCommands=[...commands],cancelledName=await cancelled;
 const answered=recordLocalAnswer(run,0,200,Date.now(),localId(500));answered.answers.forEach(answer=>localAnswerSchema.parse(answer));
 let finished=run;for(let i=0;i<3;i++)finished=recordLocalAnswer(finished,0,200+i*500,Date.now(),localId(500));localBatchSchema.parse(finished.batch);
 const protectedCases={};
 for(const kind of ['answers','startRequested','batch','plan']){
  const prior=await store.getLocalQuizRun(run.key),candidate={...prior,revision:prior.revision+1,plan:kind==='plan'?plan:null,answers:kind==='answers'?answered.answers:[],startRequested:kind==='startRequested',batch:kind==='batch'?finished.batch:null};
  await store.saveLocalQuizRun(candidate,prior.revision);await prepareLocalQuiz(run.preparation.assignmentId);
  protectedCases[kind]=JSON.stringify(await store.getLocalQuizRun(run.key))===JSON.stringify(candidate);
 }
 const protectedRun=await store.getLocalQuizRun(run.key);
 let oldRelease,oldStarted;const oldReady=new Promise(resolve=>oldStarted=resolve),oldGate=new Promise(resolve=>oldRelease=resolve);let requests=0;
 window.fetch=async(url,init)=>{const command=JSON.parse(init.body);if(command.action!=='prepare')throw Error('unexpected cancel action');if(++requests===1){oldStarted();await oldGate;}return Response.json({...run.preparation,packet:await packLocalQuizContents(values,command.knownKeys)});};
 const abort=new AbortController(),old=prepareLocalQuiz(run.preparation.assignmentId,abort.signal).catch(e=>e.name);await oldReady;abort.abort();const again=prepareLocalQuiz(run.preparation.assignmentId);await again;oldRelease();const oldName=await old;
 await new Promise(resolve=>setTimeout(resolve,0));
 const alias=await store.findLocalQuizRun(plan.attemptId,run.studentId),expired=await store.knownLocalQuizAssignmentKeys(run.identity,run.preparation.assignmentId,Date.now()+172800001),other=await store.knownLocalQuizAssignmentKeys('other-account',run.preparation.assignmentId);
 return {initialCommands,sharedAlive,cancelledName,protectedCases,reclickRequests:requests,oldName,latePreserved:JSON.stringify(await store.getLocalQuizRun(run.key))===JSON.stringify(protectedRun),aliasSameStudent:alias?.key===run.key,expiredCount:expired.length,otherCount:other.length};
};
` }, bundle: true, write: false, format: "iife", platform: "browser",
    define: { "process.env.NODE_ENV": '"production"', "process.env": "{}" },
    plugins: [{ name: "nonvisual-css", setup(builder) { builder.onLoad({ filter: /\.module\.css$/ }, () => ({ contents: "export default {};", loader: "js" })); } }],
  })).outputFiles[0].text;
  const server = http.createServer((_request, response) => { response.setHeader("Content-Type", "text/html; charset=utf-8"); response.end("<!doctype html><title>가짜 시험 자료 검사</title>"); });
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  const address = server.address(); if (!address || typeof address === "string") throw Error("Local server unavailable");
  const browser = await chromium.launch({ headless: true });
  const results: Record<string, unknown> = {};
  try {
    for (const scenario of ["old", "study", "shared", "maintenance"] as const) {
      const context = await browser.newContext(), page = await context.newPage();
      await page.goto(`http://127.0.0.1:${address.port}`); await page.addScriptTag({ content: bundle });
      const invoke = (method: string) => page.evaluate(name => (window as unknown as Record<string, () => Promise<unknown>>)[name](), method);
      if (scenario === "maintenance") {
        const result=await invoke("maintenanceProbe");expect(result).toEqual({duringExam:true,afterExam:false});results.maintenance=result;
      } else if (scenario === "shared") {
        const result = await invoke("sharedAndProtected");
        expect(result).toEqual({ initialCommands: ["prefetch", "prepare"], sharedAlive: true, cancelledName: "AbortError",
          protectedCases: { answers: true, startRequested: true, batch: true, plan: true }, reclickRequests: 2, oldName: "AbortError", latePreserved: true, aliasSameStudent: true, expiredCount: 0, otherCount: 0 });
        results.shared = result;
      } else {
        const seed = await invoke(scenario === "old" ? "seedOld" : "seedStudy");
        for (let visit = 1; visit <= (scenario === "old" ? 2 : 1); visit++) {
          await page.reload(); await page.addScriptTag({ content: bundle });
          const result = await invoke("prepareProbe") as { scans: string[]; cursors: string[]; cursorRows: string[]; stored: string; commands: string[]; packetBodies: number; packetAtomKeys: string[]; version: number };
          expect(result.scans).toEqual([]); expect(result.commands).toEqual(["prepare"]); expect(result.version).toBe(1);
          expect(result.cursors).toEqual(scenario === "old" && visit === 1 ? ["runs"] : []);
          if (scenario === "old") { expect(result.stored).toBe(seed); expect(result.packetBodies).toBe(0); expect(result.packetAtomKeys).toEqual([]); }
          else { expect((seed as string[]).length).toBeGreaterThan(0); expect(result.packetAtomKeys.some(key => (seed as string[]).includes(key))).toBe(false); }
          const { stored: _stored, packetAtomKeys, ...summary } = result; void _stored;
          results[scenario + visit] = { ...summary, packetAtoms: packetAtomKeys.length,
            preserved: scenario === "old" ? true : undefined, repeatedStudyAtoms: scenario === "study" ? 0 : undefined };
        }
      }
      await context.close();
    }
    fs.writeFileSync("docs/verification/APP-20261008-03_실제캐시검사.json", JSON.stringify({ at: new Date().toISOString(), browser: browser.version(),
      scope: "실제 준비·단어보기·IndexedDB, 가짜 3문항 HTTP. 구형 v1 최초 runs 순회는 별도 집계. 운영 인증 검사와 부하 시험이 아님.", results }, null, 2));
    console.log(JSON.stringify(results));
  } finally { await browser.close(); await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve())); }
}
void main().catch(error => { console.error(error); process.exitCode = 1; });
