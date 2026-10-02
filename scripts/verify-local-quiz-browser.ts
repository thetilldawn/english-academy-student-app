import fs from 'node:fs';
import { createHash } from 'node:crypto';
import { spawn, type ChildProcess } from 'node:child_process';
import { build } from 'esbuild';
import { chromium, expect, type BrowserContext, type Page } from '@playwright/test';
import { localFixture, localId, receiptFor } from '../src/features/quiz-player/test-support/local-quiz-fixtures';
import { packLocalQuizContents } from '../src/features/quiz-player/domain/local-quiz-content';
import { packAssignmentStudy, studyAtomKeys } from '../src/features/student-dashboard/domain/study-materials';
import { commonContentKey } from '../src/features/quiz-player/domain/local-quiz';
import type { LocalBatch, LocalPhasePlan } from '../src/features/quiz-player/contracts/local-quiz';

let localServer:ChildProcess|undefined;
async function main(){
const harness=(await build({stdin:{contents:'import * as store from "./src/features/quiz-player/client/flows/local-quiz-store"; import {holdLocalQuizScreen} from "./src/features/quiz-player/client/flows/local-quiz-screen"; window.__m05={...store,holdLocalQuizScreen};',resolveDir:process.cwd(),loader:'ts'},bundle:true,write:false,format:'iife',platform:'browser'})).outputFiles[0].text;
const flowHarness=(await build({stdin:{contents:`
  import React from 'react'; import {createRoot} from 'react-dom/client';
  import {useSharedStudy} from './src/features/student-dashboard/controller/use-shared-study';
  import {prepareLocalQuiz} from './src/features/quiz-player/client/flows/local-quiz-preparation';
  import {StartRetryButton} from './src/features/results/ui/start-retry-button';
  import {LocalQuizResume} from './src/features/quiz-player/client/components/local-quiz-player';
  function Study({manifest}){const state=useSharedStudy(manifest);return React.createElement('p',{'data-testid':'shared-study'},state.error||state.study?.words.map(w=>w.headword).join(',')||'준비 중');}
  let root;function mount(element){if(!root){const div=document.createElement('div');div.id='m05-flow';document.body.append(div);root=createRoot(div);}root.render(element);}
  window.__m05Flow={prepareLocalQuiz,study:manifest=>mount(React.createElement(Study,{manifest})),retry:(attemptId,studentId)=>{
    window.__m05Navigate=url=>{window.__m05Navigation=url;mount(React.createElement(LocalQuizResume,{attemptId,studentId,retry:true}));};
    mount(React.createElement(StartRetryButton,{attemptId}));
  }};
`,resolveDir:process.cwd(),loader:'tsx'},bundle:true,write:false,format:'iife',platform:'browser',define:{'process.env.NODE_ENV':'"production"','process.env':'{}'},plugins:[{
  name:'fake-navigation-boundary',setup(builder){
    builder.onResolve({filter:/^next\/navigation$/},()=>({path:'navigation',namespace:'fake-navigation'}));
    builder.onLoad({filter:/.*/,namespace:'fake-navigation'},()=>({contents:'export const useRouter=()=>({replace:url=>window.__m05Navigate(url)}); export const useSelectedLayoutSegments=()=>[];',loader:'js'}));
    builder.onLoad({filter:/\.module\.css$/},()=>({contents:'export default {};',loader:'js'}));
  },
}]})).outputFiles[0].text;
const origin='http://127.0.0.1:3055';
localServer=spawn(process.execPath,['node_modules/next/dist/bin/next','start','-H','127.0.0.1','-p','3055'],{windowsHide:true,env:{...process.env,APP_ORIGIN:origin},stdio:['ignore','pipe','pipe']});
const serverLog=fs.createWriteStream('.codex-tmp/m05-browser-owned-server.log');localServer.stdout?.pipe(serverLog);localServer.stderr?.pipe(serverLog);
for(let i=0;i<60;i++){try{const r=await fetch(origin+'/quiz-offline');if(r.ok)break;}catch{}if(i===59)throw Error('Local test server unavailable');await new Promise(r=>setTimeout(r,200));}
const output='docs/verification/APP-20261002-03_화면';fs.mkdirSync(output,{recursive:true});
const browser=await chromium.launch({headless:true,args:process.argv.includes('--audio-interrupt-only')?['--autoplay-policy=no-user-gesture-required']:[]});const evidence:Record<string,unknown>[]=[];
const hash=(bytes:string|Buffer)=>createHash('sha256').update(bytes).digest('hex');
const workerFile='public/quiz-offline-sw.js',originalWorker=fs.readFileSync(workerFile,'utf8');
type Options={count?:number;wrong?:number;delay?:number;wait?:boolean;loseStart?:boolean;audio?:string[];audioKind?:'prompt'|'choice';firstAudioOnly?:boolean;questionSeconds?:number;beforeStart?:(page:Page)=>Promise<void>};
async function fixture(context:BrowserContext,options:Options={}){
  const {run,plan,contents}=await localFixture(options.count??3);run.plan=null;run.clock.elapsedAt=0;run.preparation.questionTimeLimitSeconds=null;run.preparation.timingMode='none';plan.questionLimitMs=null;
  if(options.questionSeconds){run.preparation.questionTimeLimitSeconds=options.questionSeconds;run.preparation.timingMode='per_question';plan.questionLimitMs=options.questionSeconds*1000;}
  if(options.audio){
    const old=[...contents.values()];contents.clear();
    for(let i=0;i<old.length;i++){
      const voice={available:true,displayKo:null,variantId:'fake-media-check',audioUrl:options.audio[i%options.audio.length]};
      const body={...old[i].body};
      if(options.audioKind==='choice'){
        body.direction='korean_to_english';body.choices=['option1','option2','option3','option4'];
        if(!options.firstAudioOnly||i===0)body.choicePronunciations=[voice,...body.choicePronunciations.slice(1)];
      }else if(!options.firstAudioOnly||i===0)body.pronunciation=voice;
      const key=await commonContentKey(body);contents.set(key,{key,body});
    }
    run.preparation.items=[...contents.values()].map(c=>({contentId:c.body.contentId,key:c.key}));
  }
  const packet=await packLocalQuizContents([...contents.values()]);const page=await context.newPage();
  const requests:string[]=[];const errors:string[]=[];const submissions:LocalBatch[]=[];const commands:string[]=[];let offline=false;
  let retryPlan:LocalPhasePlan|undefined;let begun=false;
  await page.addInitScript(()=>{
    const root=window as typeof window&{__writes:Array<{ms:number;aborted:boolean}>;__submits:Array<{phase:string;ms:number;status:number}>;__results:number[]};root.__writes=[];root.__submits=[];root.__results=[];
    const originalFetch=window.fetch;
    window.fetch=async(...args:Parameters<typeof fetch>)=>{
      const requestUrl=typeof args[0]==='string'?args[0]:args[0] instanceof URL?args[0].href:args[0].url;
      const body=typeof args[1]?.body==='string'?JSON.parse(args[1].body):null;
      if(!requestUrl.endsWith('/api/student/local-quiz')||body?.action!=='submit')return originalFetch(...args);
      const at=performance.now();try{const response=await originalFetch(...args);root.__submits.push({phase:body.batch.phase,ms:performance.now()-at,status:response.status});return response;}
      catch(error){root.__submits.push({phase:body.batch.phase,ms:performance.now()-at,status:0});throw error;}
    };
    let lastAnswerAt=0,hadResult=false;
    document.addEventListener('keydown',event=>{if(/^[1-4]$/.test(event.key)&&document.querySelector('#quiz-prompt'))lastAnswerAt=performance.now();},true);
    new MutationObserver(()=>{
      const hasResult=document.body?.textContent?.includes('시험 결과가 저장됐습니다.')??false;
      if(hasResult&&!hadResult&&lastAnswerAt)root.__results.push(performance.now()-lastAnswerAt);hadResult=hasResult;
    }).observe(document,{subtree:true,childList:true,characterData:true});
    const original=IDBDatabase.prototype.transaction;
    IDBDatabase.prototype.transaction=function(...args:Parameters<IDBDatabase['transaction']>){
      const tx=original.apply(this,args);const names=typeof args[0]==='string'?[args[0]]:[...args[0]];
      if(args[1]==='readwrite'&&names.includes('runs')){const at=performance.now();for(const event of ['complete','abort'])tx.addEventListener(event,()=>root.__writes.push({ms:performance.now()-at,aborted:event==='abort'}),{once:true});}return tx;
    };
  });
  context.on('request',r=>requests.push(new URL(r.url()).pathname));page.on('pageerror',e=>errors.push(e.message));
  await context.route(origin+'/api/student/local-quiz',async route=>{
    const command=route.request().postDataJSON();
    commands.push(command.action);
    if(command.action==='begin'){
      const first=!begun;if(first){plan.startedAt=new Date().toISOString();begun=true;}plan.serverNow=new Date().toISOString();
      if(first&&options.loseStart)return route.abort('failed');return route.fulfill({json:plan});
    }
    if(command.action==='retry'){retryPlan={...plan,phase:'retry',officialPhase:'retry',planHash:'e'.repeat(64),startedAt:new Date().toISOString(),serverNow:new Date().toISOString(),items:plan.items.slice(0,options.wrong).map((q,i)=>({...q,order:i+1}))};return route.fulfill({json:retryPlan});}
    if(command.action==='submit'){
      submissions.push(command.batch);if(offline)return route.abort('internetdisconnected');
      if(options.delay)await new Promise(r=>setTimeout(r,options.delay));
      const receipt=await receiptFor(command.batch,command.batch.phase==='retry'||!options.wrong);
      if(!receipt.result.finalized)receipt.retryTargets=plan.items.slice(0,options.wrong).map(q=>q.id);
      return route.fulfill({json:receipt});
    }
    throw Error('Unexpected API '+command.action);
  });
  await page.goto(origin+'/quiz-offline');
  await page.evaluate(async ({run,packet})=>{
    localStorage.setItem('student-private-cache-identity',run.identity);
    const db=await new Promise<IDBDatabase>((resolve,reject)=>{const q=indexedDB.open('english-academy-local-quiz-v1',1);q.onupgradeneeded=()=>['contents','atoms','runs','meta'].forEach(k=>q.result.createObjectStore(k,{keyPath:'key'}));q.onsuccess=()=>resolve(q.result);q.onerror=()=>reject(q.error);});
    await new Promise<void>((resolve,reject)=>{const tx=db.transaction(['contents','atoms','runs','meta'],'readwrite');tx.oncomplete=()=>resolve();tx.onabort=()=>reject(tx.error);
      packet.contents.forEach(c=>tx.objectStore('contents').put({...c,cachedAt:Date.now()}));packet.atoms.forEach(a=>tx.objectStore('atoms').put({...a,cachedAt:Date.now()}));
      tx.objectStore('runs').put({...run,clock:{wallAt:Date.now(),elapsedAt:0}});tx.objectStore('meta').put({key:'device',value:run.device});});db.close();
  },{run,packet});
  await options.beforeStart?.(page);
  await page.goto(origin+'/quiz-offline#'+run.key);
  if(options.wait!==false)await expect(page.locator('#quiz-prompt')).toHaveText('sample1',{timeout:40000});
  await page.waitForTimeout(150);requests.length=0;
  return {page,run,plan,requests,errors,submissions,commands,setOffline:async (value:boolean)=>{offline=value;await context.setOffline(value);}};
}
async function choose(page:Page,index:number,next?:string){
  await page.locator('#quiz-prompt').focus();await page.keyboard.press(String(index+1));
  if(next)await expect(page.locator('#quiz-prompt')).toHaveText(next);
}
try{
  if(process.argv.includes('--audio-interrupt-only')){
    const samples=8000*8,wav=Buffer.alloc(44+samples*2);
    wav.write('RIFF',0);wav.writeUInt32LE(wav.length-8,4);wav.write('WAVEfmt ',8);wav.writeUInt32LE(16,16);wav.writeUInt16LE(1,20);wav.writeUInt16LE(1,22);wav.writeUInt32LE(8000,24);wav.writeUInt32LE(16000,28);wav.writeUInt16LE(2,32);wav.writeUInt16LE(16,34);wav.write('data',36);wav.writeUInt32LE(samples*2,40);
    for(let i=0;i<samples;i++)wav.writeInt16LE(Math.round(Math.sin(i*2*Math.PI*220/8000)*2000),44+i*2);
    const results=[];
    for(const kind of ['prompt','choice'] as const)for(const trigger of ['answer','timeout'] as const){
      const context=await browser.newContext({serviceWorkers:'allow',viewport:{width:390,height:844}});
      await context.route('https://audio.invalid/m05-interrupt.wav',route=>route.fulfill({contentType:'audio/wav',body:wav}));
      await context.addInitScript(()=>{
        const root=window as typeof window&{__audioCheck:{active:HTMLMediaElement|null;inputs:number[];pauses:Array<{at:number;question:string|null;currentTime:number}>}};
        root.__audioCheck={active:null,inputs:[],pauses:[]};
        document.addEventListener('keydown',e=>{if(/^[1-4]$/.test(e.key))root.__audioCheck.inputs.push(performance.now());},true);
        document.addEventListener('click',e=>{if(e.target instanceof Element&&e.target.closest('button[data-feedback]'))root.__audioCheck.inputs.push(performance.now());},true);
        const play=HTMLMediaElement.prototype.play,pause=HTMLMediaElement.prototype.pause;
        HTMLMediaElement.prototype.play=function(){root.__audioCheck.active=this;return play.call(this);};
        HTMLMediaElement.prototype.pause=function(){if(!this.paused)root.__audioCheck.pauses.push({at:performance.now(),question:document.querySelector('#quiz-prompt')?.textContent??null,currentTime:this.currentTime});return pause.call(this);};
      });
      const f=await fixture(context,{count:2,audio:['https://audio.invalid/m05-interrupt.wav'],audioKind:kind,firstAudioOnly:true,questionSeconds:trigger==='timeout'?5:undefined});
      const speaking=()=>f.page.evaluate(()=>{const a=(window as typeof window&{__audioCheck:{active:HTMLMediaElement|null}}).__audioCheck.active;return Boolean(a&&!a.paused&&a.currentTime>0);});
      if(trigger==='timeout')await f.page.waitForTimeout(3600);
      if(kind==='choice'||trigger==='timeout')await f.page.getByRole('button',{name:/발음/}).first().click();
      await expect.poll(speaking).toBe(true);f.requests.length=0;
      const started=await f.page.evaluate(()=>performance.now());
      if(trigger==='answer'){
        if(kind==='prompt')await choose(f.page,0);
        else await f.page.getByRole('button',{name:/4\s*option4/}).click();
      }
      await expect(f.page.locator('#quiz-prompt')).toHaveText('sample2',{timeout:8000});
      const actual=await f.page.evaluate(since=>{const r=(window as typeof window&{__audioCheck:{active:HTMLMediaElement|null;inputs:number[];pauses:Array<{at:number;question:string|null;currentTime:number}>}}).__audioCheck;return {inputAt:r.inputs.at(-1),pause:r.pauses.find(p=>p.at>=since),stillPlaying:Boolean(r.active&&!r.active.paused),mediaTime:r.active?.currentTime};},started);
      const result={kind,trigger,...actual,answerToPauseMs:actual.inputAt&&actual.pause?actual.pause.at-actual.inputAt:null,examRequests:f.requests.filter(p=>p.startsWith('/api/'))};
      results.push(result);console.log(JSON.stringify(result));
      fs.writeFileSync('.codex-tmp/m05-audio-interrupt-last-run.json',JSON.stringify({at:new Date().toISOString(),results},null,2));
      expect(actual.pause?.question).toBe('sample1');expect(actual.stillPlaying).toBe(false);expect(result.examRequests).toEqual([]);
      if(trigger==='answer')expect(result.answerToPauseMs).toBeLessThan(50);
      await context.close();
    }
    fs.writeFileSync('docs/verification/APP-20261002-03_음성중단검사.json',JSON.stringify({at:new Date().toISOString(),browser:browser.version(),htmlSha256:hash(fs.readFileSync('.next/server/app/quiz-offline.html')),scope:'실제 빌드/HTMLAudioElement와 합성8초 WAV, 가짜 시험 API. 자동재생 허용 옵션 사용. 자동 문제음·수동 선택지음의 답 선택/시간 종료 중단 검사이며 CDN 가용성·발음 내용·실스피커 출력 검사는 아님.',cases:results},null,2));return;
  }
  if(process.argv.includes('--audio-only')){
    const sources=['https://media.merriam-webster.com/audio/prons/en/us/mp3/c/collec01.mp3','https://xdxhswjgksukjmpbzqgz.supabase.co/storage/v1/object/public/vocab-pronunciation-audio/pronunciation/google_cloud_text_to_speech/profile-286866721f7f4ee8/15944f75c56cbcb2c6180409f068808cb675f1309a0fd63b6cac7fb856b6d7cc.mp3'];
    const audioContext=await browser.newContext({serviceWorkers:'allow'});
    const mediaNetwork:Array<{url:string;status?:number;error?:string}> = [];
    audioContext.on('requestfailed',request=>{if(sources.includes(request.url()))mediaNetwork.push({url:request.url(),error:request.failure()?.errorText});});
    audioContext.on('response',response=>{if(sources.includes(response.url()))mediaNetwork.push({url:response.url(),status:response.status()});});
    await audioContext.addInitScript(()=>{
      const root=window as typeof window&{__mediaEnded:Array<{url:string;duration:number}>;__mediaEvents:Array<{url:string;event:string;at:number;detail?:string}>};root.__mediaEnded=[];root.__mediaEvents=[];
      const pause=HTMLMediaElement.prototype.pause;HTMLMediaElement.prototype.pause=function(){if(!this.paused)root.__mediaEvents.push({url:this.currentSrc||this.src,event:'pause-called',at:performance.now(),detail:new Error().stack});return pause.call(this);};
      const play=HTMLMediaElement.prototype.play;HTMLMediaElement.prototype.play=function(){
        root.__mediaEvents.push({url:this.src,event:'play-called',at:performance.now()});
        for(const event of ['playing','error','pause'])this.addEventListener(event,()=>root.__mediaEvents.push({url:this.currentSrc||this.src,event,at:performance.now(),detail:this.error?.message}),{once:true});
        this.addEventListener('ended',()=>root.__mediaEnded.push({url:this.currentSrc,duration:this.duration}),{once:true});
        const result=play.call(this);void result.catch(error=>root.__mediaEvents.push({url:this.currentSrc||this.src,event:'play-rejected',at:performance.now(),detail:String(error)}));return result;
      };
    });
    const a=await fixture(audioContext,{audio:sources});
    for(let i=0;i<2;i++){
      await a.page.getByRole('button',{name:/발음/}).click();
      try{await expect.poll(()=>a.page.evaluate(url=>(window as typeof window&{__mediaEnded:Array<{url:string;duration:number}>}).__mediaEnded.some(e=>e.url===url&&e.duration>0),sources[i]),{timeout:15000}).toBe(true);}
      catch(error){console.error(JSON.stringify({sourceIndex:i,mediaNetwork,mediaEvents:await a.page.evaluate(()=>(window as typeof window&{__mediaEvents:unknown[]}).__mediaEvents)}));throw error;}
      if(i===0)await choose(a.page,0,'sample2');
    }
    expect(a.requests.filter(p=>p.startsWith('/api/'))).toEqual([]);
    const actual=await a.page.evaluate(()=>(window as typeof window&{__mediaEnded:Array<{url:string;duration:number}>}).__mediaEnded);
    const result={at:new Date().toISOString(),browser:browser.version(),scope:'실제 새 시험 UI의 CDN 직접 재생. 가짜 문제/준비 API, 실제 공개 음원 두 개. 사람의 청취/발음 내용 검수는 아님.',ended:actual,mediaNetwork,appAudioProxyRequests:0,examDataRequestsDuringPlay:0};
    fs.writeFileSync('docs/verification/APP-20261002-03_CDN음원검사.json',JSON.stringify(result,null,2));console.log(JSON.stringify(result));await audioContext.close();return;
  }
  if(!process.argv.includes('--worker-only')){
  const sharedContext=await browser.newContext({serviceWorkers:'allow'});const sharedPage=await sharedContext.newPage();
  sharedPage.on('pageerror',error=>console.error('Shared-study browser: '+error.stack));
  const shared=await localFixture();const bodies=[...shared.contents.values()];
  const study={assignmentId:shared.run.preparation.assignmentId,title:'가짜 학습과 시험 연결',mode:'book_meaning_choice' as const,
    words:bodies.map((c,i)=>({key:c.body.contentId,headword:c.body.prompt,meaning:c.body.choices[i%4],definition:null,example:null,pronunciation:c.body.pronunciation}))};
  const packedStudy=await packAssignmentStudy(study);const knownStudy=studyAtomKeys(packedStudy.manifest);const preparedPackets:Array<{known:string[];packet:Awaited<ReturnType<typeof packLocalQuizContents>>}>=[];
  await sharedContext.route(origin+'/api/student/local-quiz',async route=>{
    const command=route.request().postDataJSON();
    if(command.action==='study')return route.fulfill({json:await packAssignmentStudy(study,command.knownKeys)});
    if(command.action==='prepare'){
      const packet=await packLocalQuizContents(bodies,command.knownKeys);preparedPackets.push({known:command.knownKeys,packet});
      return route.fulfill({json:{...shared.run.preparation,assignmentId:command.assignmentId,preparationId:command.assignmentId===study.assignmentId?shared.run.key:localId(602),packet}});
    }
    if(command.action==='begin'){shared.plan.startedAt=new Date().toISOString();shared.plan.serverNow=shared.plan.startedAt;return route.fulfill({json:shared.plan});}
    throw Error('Unexpected shared study command '+command.action);
  });
  await sharedPage.goto(origin+'/quiz-offline');await sharedPage.evaluate(()=>localStorage.setItem('student-private-cache-identity','original'));
  await sharedPage.addScriptTag({content:flowHarness});
  await sharedPage.evaluate(manifest=>(window as unknown as {__m05Flow:{study:(m:unknown)=>void}}).__m05Flow.study(manifest),packedStudy.manifest);
  await expect(sharedPage.getByTestId('shared-study')).toHaveText('sample1,sample2,sample3');
  const firstUrl=await sharedPage.evaluate(id=>(window as unknown as {__m05Flow:{prepareLocalQuiz:(id:string)=>Promise<string>}}).__m05Flow.prepareLocalQuiz(id),study.assignmentId);
  await sharedPage.evaluate(id=>(window as unknown as {__m05Flow:{prepareLocalQuiz:(id:string)=>Promise<string>}}).__m05Flow.prepareLocalQuiz(id),localId(604));
  expect(knownStudy.every(key=>preparedPackets[0].known.includes(key))).toBe(true);
  expect(preparedPackets[0].packet.atoms.some(atom=>knownStudy.includes(atom.key))).toBe(false);
  expect(preparedPackets[1].packet).toEqual({contents:[],atoms:[]});
  // Damage one cached atom while preserving its key; preparation must validate,
  // request only the missing material and restore the original immutable text.
  const damagedKey=packedStudy.manifest.words[0].headwordRef;
  await sharedPage.evaluate(async key=>{
    const db=await new Promise<IDBDatabase>(resolve=>{const request=indexedDB.open('english-academy-local-quiz-v1',1);request.onsuccess=()=>resolve(request.result);});
    await new Promise<void>((resolve,reject)=>{const tx=db.transaction('atoms','readwrite');tx.oncomplete=()=>resolve();tx.onabort=()=>reject(tx.error);const store=tx.objectStore('atoms'),request=store.get(key);request.onsuccess=()=>store.put({...request.result,value:{kind:'text',text:'corrupted'}});});db.close();
  },damagedKey);
  await sharedPage.evaluate(id=>(window as unknown as {__m05Flow:{prepareLocalQuiz:(id:string)=>Promise<string>}}).__m05Flow.prepareLocalQuiz(id),study.assignmentId);
  expect(preparedPackets[2].known).not.toContain(damagedKey);expect(preparedPackets[2].packet.atoms.map(a=>a.key)).toEqual([damagedKey]);
  expect(preparedPackets[2].packet.contents).toHaveLength(1);
  await sharedPage.goto(origin+firstUrl);await expect(sharedPage.locator('#quiz-prompt')).toHaveText('sample1');
  await sharedPage.setViewportSize({width:390,height:844});await sharedPage.addStyleTag({content:'html{font-size:32px!important}'});
  expect(await sharedPage.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  await sharedPage.screenshot({path:output+'/큰글자_모바일.png'});
  await sharedPage.goto(origin+'/quiz-offline');
  const blocker=await sharedContext.newPage();await blocker.goto(origin+'/quiz-offline');
  await blocker.evaluate(()=>{void navigator.locks.request('quiz-offline-assets-v1',()=>new Promise<void>(resolve=>{(window as unknown as {__releaseScreen:()=>void}).__releaseScreen=resolve;}));});
  await expect.poll(()=>blocker.evaluate(()=>Boolean((window as unknown as {__releaseScreen?:()=>void}).__releaseScreen))).toBe(true);
  await sharedPage.goto(origin+firstUrl);
  await expect.poll(()=>sharedPage.evaluate(async()=>(await navigator.locks.query()).pending?.filter(l=>l.name==='quiz-offline-assets-v1').length??0)).toBe(1);
  await sharedPage.goto(origin+'/quiz-offline');
  await expect.poll(()=>sharedPage.evaluate(async()=>(await navigator.locks.query()).pending?.filter(l=>l.name==='quiz-offline-assets-v1').length??0)).toBe(0);
  await blocker.evaluate(()=>(window as unknown as {__releaseScreen:()=>void}).__releaseScreen());
  evidence.push({case:'실제 학습 훅→공용 기기 저장→시험 준비→다른 배정 재사용',sharedStudyAtoms:knownStudy.length,studyAtomsDownloadedAgain:0,secondAssignmentContents:0,secondAssignmentAtoms:0,corruptAtomRepair:{atoms:1,contents:1,restoredOriginal:true},firstQuizOpened:true,largeText390HorizontalOverflow:false,pendingScreenLockCancelled:true});
  await sharedContext.close();
  if(process.argv.includes('--shared-only')){fs.writeFileSync('docs/verification/APP-20261002-03_학습손상복구검사.json',JSON.stringify({at:new Date().toISOString(),scope:'실제 학습 훅과 기기 저장·준비 함수/새 시험 화면, 가짜 HTTP/이동 경계, 큰 글자390px와 실제 WebLocks 취소',cases:evidence},null,2));console.log(JSON.stringify(evidence));return;}

  const context=await browser.newContext({viewport:{width:1280,height:900},serviceWorkers:'allow'});const f=await fixture(context);
  await f.page.screenshot({path:output+'/기본시험_PC.png'});await choose(f.page,0,'sample2');
  expect(f.requests).toEqual([]);await f.page.setViewportSize({width:390,height:844});await f.page.screenshot({path:output+'/기본시험_모바일.png'});
  expect(await f.page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  await choose(f.page,1,'sample3');expect(f.requests).toEqual([]);
  await choose(f.page,2);await expect(f.page.getByText('시험 결과가 저장됐습니다.')).toBeVisible();expect(f.submissions).toHaveLength(1);expect(f.errors).toEqual([]);
  evidence.push({case:'정상 PC와 390px',duringPlayRequests:0,endSubmissions:f.submissions.length,consoleErrors:f.errors});await context.close();

  const offlineContext=await browser.newContext({viewport:{width:390,height:844},serviceWorkers:'allow'});const o=await fixture(offlineContext);
  await choose(o.page,0,'sample2');await o.setOffline(true);await o.page.reload({waitUntil:'domcontentloaded'});
  await expect(o.page.locator('#quiz-prompt')).toContainText('sample2',{timeout:40000});
  await o.page.screenshot({path:output+'/오프라인_새로고침.png'});o.requests.length=0;
  await choose(o.page,1,'sample3');expect(o.requests).toEqual([]);await choose(o.page,2);
  await expect(o.page.locator('p[role="alert"]')).toContainText('보관');const first=o.submissions[0];expect(first.answers).toHaveLength(3);
  await o.page.screenshot({path:output+'/제출대기_모바일.png'});await o.setOffline(false);
  // Chromium's CDP offline mode restores navigator.onLine during a SW-backed
  // reload, without a later online event. Supply that OS signal explicitly.
  await o.page.evaluate(()=>window.dispatchEvent(new Event('online')));
  await expect(o.page.getByText('시험 결과가 저장됐습니다.')).toBeVisible();expect(o.submissions).toHaveLength(2);expect(o.submissions[1]).toEqual(first);expect(o.errors).toEqual([]);
  evidence.push({case:'오프라인 새로고침과 재연결',resumeQuestion:2,duringPlayRequests:0,endAttempts:o.submissions.length,sameBatch:true,onlineSignal:'CDP 재로딩 한계로 online 이벤트 명시 발생',consoleErrors:o.errors});
  await offlineContext.close();

  const failureContext=await browser.newContext({viewport:{width:390,height:844},serviceWorkers:'allow'});const f2=await fixture(failureContext);
  await f2.page.evaluate(()=>{
    const original=IDBObjectStore.prototype.put;
    IDBObjectStore.prototype.put=function(...args:Parameters<IDBObjectStore['put']>){
      const request=original.apply(this,args);
      if(this.name==='runs'){IDBObjectStore.prototype.put=original;request.addEventListener('success',()=>this.transaction.abort(),{once:true});}
      return request;
    };
  });
  await choose(f2.page,0);await expect(f2.page.getByRole('alert').filter({hasText:'답을 기기에 보관하지 못했습니다'})).toBeVisible();
  await expect(f2.page.locator('#quiz-prompt')).toHaveText('sample1');expect(f2.submissions).toHaveLength(0);expect(f2.requests).toEqual([]);
  await f2.page.screenshot({path:output+'/저장거래실패_모바일.png'});await f2.page.getByRole('button',{name:'다시 시도',exact:true}).click();
  await expect(f2.page.locator('#quiz-prompt')).toHaveText('sample2');
  const second=await failureContext.newPage();await second.goto(origin+'/quiz-offline#'+f2.run.key);
  await expect(second.locator('p[role="alert"]')).toContainText('다른 탭');
  await f2.page.close();await second.reload();await expect(second.locator('#quiz-prompt')).toHaveText('sample2');
  evidence.push({case:'실제 IDB put 성공 후 거래 중단과 두 탭',failedCommitAdvanced:false,recoveredQuestion:2,secondTabBlocked:true,apiDuringPlay:0});
  await failureContext.close();

  const lostContext=await browser.newContext({serviceWorkers:'allow'});const lost=await fixture(lostContext,{loseStart:true,wait:false});
  await expect(lost.page.locator('p[role="alert"]')).toBeVisible();const started=lost.plan.startedAt;
  await lost.page.goto(origin+'/quiz-offline');await expect(lost.page.getByText('시험 목록에서 시험을 선택해 주세요.')).toBeVisible();
  await lost.page.goto(origin+'/quiz-offline#'+lost.run.key);await expect(lost.page.locator('#quiz-prompt')).toHaveText('sample1');
  expect(lost.plan.startedAt).toBe(started);expect(lost.commands).toEqual(['begin','begin']);expect(lost.plan.attemptId).toBe(lost.run.key);
  evidence.push({case:'시작 응답 유실 후 같은 기기 재진입',samePreparationAndAttempt:true,clockPreserved:true,startTransportAttempts:2});
  await lostContext.close();

  const storeContext=await browser.newContext();const storePage=await storeContext.newPage();await storePage.goto(origin+'/quiz-offline');await storePage.addScriptTag({content:harness});
  const seed=await localFixture(),seedPacket=await packLocalQuizContents([...seed.contents.values()]);
  const storeEvidence=await storePage.evaluate(async ({run,packet})=>{
    const s=(window as unknown as {__m05:typeof import('../src/features/quiz-player/client/flows/local-quiz-store')}).__m05;
    const start=1000,ttl=172800000,keys=packet.contents.map(c=>c.key);await s.cacheLocalQuizContents(packet,start);
    const fresh=(await s.readLocalQuizContents(keys,false,start+ttl-1)).size,expired=(await s.readLocalQuizContents(keys,false,start+ttl)).size;
    const pinned={...run,startRequested:true,plan:null};await s.saveLocalQuizRun(pinned,null);await s.pruneLocalQuizContents(start+ttl+1);
    const protectedCount=(await s.readLocalQuizContents(keys,true,start+ttl+1)).size;
    const races=await Promise.allSettled([s.saveLocalQuizRun({...pinned,revision:1},0),s.saveLocalQuizRun({...pinned,revision:1},0)]);
    const latest=await s.getLocalQuizRun(run.key);
    await s.saveLocalQuizRun({...latest!,revision:2,startRequested:false,plan:null,batch:null},1);await s.pruneLocalQuizContents(start+ttl+1);
    return {fresh,expired,protectedCount,successfulConcurrentWrites:races.filter(r=>r.status==='fulfilled').length,expiredUnpinned:(await s.readLocalQuizContents(keys,true)).size,answerRecordKept:Boolean(await s.getLocalQuizRun(run.key))};
  },{run:seed.run,packet:seedPacket});
  expect(storeEvidence).toEqual({fresh:3,expired:0,protectedCount:3,successfulConcurrentWrites:1,expiredUnpinned:0,answerRecordKept:true});
  evidence.push({case:'실제 공용 표시48시간/진행 보호/정리와 동시 저장',...storeEvidence});await storeContext.close();

  }
  const updateContext=await browser.newContext({serviceWorkers:'allow'});const u=await fixture(updateContext);await choose(u.page,0,'sample2');u.requests.length=0;
  fs.writeFileSync(workerFile,originalWorker.replace('const cacheName =', "manifest.build += '-m05-synthetic-update';\nconst cacheName ="));
  expect(await (await fetch(origin+'/quiz-offline-sw.js?m05-update=1')).text()).toContain('m05-synthetic-update');
  const cdp=await updateContext.newCDPSession(u.page);await cdp.send('ServiceWorker.enable');
  const changes:string[]=[];
  const terminal=new Promise<string>((resolve,reject)=>{
    const timer=setTimeout(()=>reject(Error('worker update states: '+JSON.stringify(changes))),10000);
    cdp.on('ServiceWorker.workerVersionUpdated',event=>{for(const version of event.versions){
      if(!version.scriptURL.includes('?m05-update=1'))continue;changes.push(version.status);
      if(['redundant','installed','activated'].includes(version.status)){clearTimeout(timer);resolve(version.status);}
    }});
  });
  await u.page.evaluate(()=>navigator.serviceWorker.register('/quiz-offline-sw.js?m05-update=1',{scope:'/quiz-offline',updateViaCache:'none'}).then(()=>undefined));
  const state=await terminal;await cdp.detach();
  expect(state).toBe('redundant');expect(u.requests.filter(p=>p!=='/quiz-offline-sw.js')).toEqual([]);
  fs.writeFileSync(workerFile,originalWorker);await u.setOffline(true);await u.page.reload({waitUntil:'domcontentloaded'});
  await expect(u.page.locator('#quiz-prompt')).toHaveText('sample2');await u.setOffline(false);
  await u.page.goto(origin+'/quiz-offline');await expect(u.page.getByText('시험 목록에서 시험을 선택해 주세요.')).toBeVisible();
  const removed=await u.page.evaluate(async()=>{
    const name=(await caches.keys()).find(n=>n.startsWith('quiz-screen-v1-'))!;const cache=await caches.open(name);
    const keys=(await cache.keys()).filter(q=>new URL(q.url).pathname.endsWith('.js')).slice(0,2);await Promise.all(keys.map(k=>cache.delete(k)));return keys.map(k=>new URL(k.url).pathname);
  });
  await u.page.reload();await expect(u.page.getByText('시험 목록에서 시험을 선택해 주세요.')).toBeVisible();
  const restored=await u.page.evaluate(async paths=>{const cache=await caches.open((await caches.keys()).find(n=>n.startsWith('quiz-screen-v1-'))!);return Promise.all(paths.map(async p=>Boolean(await cache.match(p))));},removed);
  expect(restored).toEqual([true,true]);
  await u.page.evaluate(async()=>{for(const name of await caches.keys())if(name.startsWith('quiz-screen-v1-'))await (await caches.open(name)).delete('/quiz-offline');});
  await u.page.reload();await expect(u.page.getByText('시험 목록에서 시험을 선택해 주세요.')).toBeVisible();
  await u.page.goto(origin+'/quiz-offline#'+u.run.key);await expect(u.page.locator('#quiz-prompt')).toHaveText('sample2');
  evidence.push({case:'풀이 중 화면 갱신 차단/옛 화면 오프라인/공용 문서와 병렬 청크 복구',updateState:state,assetRequestsDuringPlay:0,parallelChunksRestored:removed.length,documentRestored:true,resumeQuestion:2});
  await updateContext.close();

  for(const {count,delay} of process.argv.includes('--worker-only')?[]:[{count:99,delay:0},{count:99,delay:150},{count:50,delay:0}]){
    const manyContext=await browser.newContext({viewport:{width:1280,height:900},serviceWorkers:'allow'});const many=await fixture(manyContext,{count,wrong:10,delay});
    for(let i=0;i<count;i++){await choose(many.page,i<10?(i+1)%4:i%4,i<count-1?'sample'+(i+2):undefined);if(i<count-1)expect(many.requests).toEqual([]);}
    await expect(many.page.getByText('시험 결과가 저장됐습니다.')).toBeVisible();expect(many.submissions).toHaveLength(1);
    let resultProtocolReads=0;
    if(count===50){
      await manyContext.route(origin+'/api/student/local-quiz-protocol/'+many.plan.attemptId,async route=>{resultProtocolReads++;return route.fulfill({json:{local:true}});});
      await many.page.goto(origin+'/quiz-offline');await many.page.addScriptTag({content:flowHarness});
      await many.page.evaluate(({attemptId,studentId})=>(window as unknown as {__m05Flow:{retry:(a:string,s:string)=>void}}).__m05Flow.retry(attemptId,studentId),{attemptId:many.plan.attemptId,studentId:many.run.studentId});
    }
    await many.page.getByRole('button',{name:'재시험 시작'}).click();await expect(many.page.locator('#quiz-prompt')).toHaveText('sample1');await many.page.waitForTimeout(150);many.requests.length=0;
    for(let i=0;i<10;i++){await choose(many.page,i%4,i<9?'sample'+(i+2):undefined);if(i<9)expect(many.requests).toEqual([]);}
    await expect(many.page.getByText('시험 결과가 저장됐습니다.')).toBeVisible();expect(many.submissions).toHaveLength(2);expect(many.commands).toEqual(['begin','submit','retry','submit']);
    const writes=await many.page.evaluate(()=>(window as typeof window&{__writes:Array<{ms:number;aborted:boolean}>}).__writes);
    const times=writes.filter(w=>!w.aborted).map(w=>w.ms).sort((a,b)=>a-b);
    const timing=await many.page.evaluate(()=>{const root=window as typeof window&{__submits:Array<{phase:string;ms:number;status:number}>;__results:number[]};return {submissions:root.__submits,lastAnswerToOfficialResultMs:root.__results};});
    expect(timing.submissions.map(s=>s.status)).toEqual(count===50?[200]:[200,200]);expect(timing.lastAnswerToOfficialResultMs).toHaveLength(count===50?1:2);
    evidence.push({case:count+'문항과 공식 대상10 재시험',fakeServerDelayMs:delay,duringPlayRequests:0,initialAnswers:count,retryAnswers:10,phaseSubmissions:2,contentReloads:0,
      localTransactionMs:{count:times.length,p50:times[Math.floor(times.length*.5)],p95:times[Math.floor(times.length*.95)],max:times.at(-1)},...timing,timingScope:count===50?'결과 화면 경유 재진입 후 재시험 구간':'최초와 재시험 전체',resultProtocolReads,viaResultRetryButton:count===50,consoleErrors:many.errors});
    expect(many.errors).toEqual([]);await manyContext.close();
  }
  fs.writeFileSync(process.argv.includes('--worker-only')?'.codex-tmp/m05-worker-browser.json':'docs/verification/APP-20261002-03_브라우저검사.json',JSON.stringify({at:new Date().toISOString(),browser:browser.version(),workerSha256:hash(originalWorker),htmlSha256:hash(fs.readFileSync('.next/server/app/quiz-offline.html')),scope:'실제 빌드 시험 화면/IndexedDB/WebLocks/ServiceWorker, 서버 응답은 가짜 자료. 학습 훅·결과 버튼·원기기 복원은 별도 검사 화면에 실제 코드를 주입하며 Next 이동 경계와 CSS만 대체. 실제 인증된 결과 페이지 왕복은 아님. 음원은 CDN 직접재생으로 별도 검사.',cases:evidence},null,2));
  console.log(JSON.stringify(evidence));
}finally{fs.writeFileSync(workerFile,originalWorker);await browser.close();}
}
void main().catch(error=>{console.error(error);process.exitCode=1;}).finally(()=>localServer?.kill());
