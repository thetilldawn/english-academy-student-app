import fs from "node:fs";
import { createServer } from "node:http";
import { createHash } from "node:crypto";
import { build } from "esbuild";
import { chromium, expect } from "@playwright/test";
import { EMPTY_LIBRARY_FILTERS, type LibraryCatalog, type LibraryTemplate } from "../src/features/wordbook-compositions/contracts/library";
import { libraryQuerySchema, type LibraryCriteria } from "../src/features/wordbook-compositions/contracts/library-query";
import { libraryWriteCommandSchema, type TemplateKind } from "../src/features/wordbook-compositions/contracts/library-v3";
import { queryFixture, versionSummary } from "../src/features/wordbook-compositions/ui/library-query.fixture";

const id=(n:number)=>`00000000-0000-4000-8000-${String(n).padStart(12,"0")}`;
const metadata={title:"가짜 혼합 구성",tags:["이전 저장 설명"],school:"가짜고",targetGrade:"g11",schoolYear:2026,semester:2 as const,assessment:"기말",purpose:"교사 자유 메모"};
function fixtures(){
  const catalog:LibraryCatalog={viewerId:id(99),scopes:[2024,2025].map((year,i)=>({id:id(i+1),version:"a".repeat(64),name:`${year}년 주제`,sourceTitle:`가짜 ${year}년 9월 원고`,availability:"available",
    source:{datasetId:id(10+i),unitId:id(20+i),kind:"exam_use",releaseId:id(30+i),releaseVersion:"b".repeat(64),fileHash:"c".repeat(64),locator:"fake"},
    classification:{kind:"mock",sourceGrade:"g12",exam:{executionYear:year,examMonth:9,examKind:"mock",academicYear:null,agency:"가짜",typeCode:"topic",typeLabel:"주제",questionNumbers:[23],sharedPassage:false},lesson:null,day:null,publisher:null,school:null,targetGrade:null,schoolYear:null,semester:null,assessment:null,purpose:null},
    occurrences:[{key:String(i+1).repeat(64),sourceRow:1,sourceEntryId:i+1,rowHash:"d".repeat(64),state:"included",headword:`fake${i+1}`,meaning:`가짜 뜻 ${i+1}`}],
  })),templates:[]};
  const textbook=structuredClone(catalog.scopes[0]!);textbook.id=id(5);textbook.source.datasetId=id(15);textbook.sourceTitle="가짜 교과서";textbook.name="가짜 교과서 2과";
  textbook.classification={...textbook.classification,kind:"textbook",exam:null,lesson:2};textbook.occurrences=[{...textbook.occurrences[0]!,key:"5".repeat(64),sourceEntryId:5}];catalog.scopes.push(textbook);
  const t:LibraryTemplate={id:id(50),revision:1,metadata,versions:[{id:id(52),number:1,contentHash:"e".repeat(64),recipe:{filters:EMPTY_LIBRARY_FILTERS,scopes:[{id:id(1),version:"a".repeat(64)},{id:id(5),version:"a".repeat(64)}],excludedOccurrenceKeys:[],scopeStatus:"confirmed"},includedKeys:["1".repeat(64),"5".repeat(64)],sourceCount:2,sourceVersionId:null,datasetId:null,createdAt:"2026-10-02T00:00:00Z"}]};
  catalog.templates=[t,...Array.from({length:25},(_,i)=>({...structuredClone(t),id:id(100+i),metadata:{...metadata,title:`가짜 목록 ${i+1}`},versions:[{...t.versions[0]!,id:id(200+i),recipe:{...t.versions[0]!.recipe,scopes:[],scopeStatus:"unconfirmed" as const},includedKeys:[],sourceCount:0}]}))];
  const kinds=new Map<string,TemplateKind|null>(catalog.templates.map((t,i)=>[t.id,i===0?null:i%2?"performance_assessment":"other"]));
  return{catalog,kinds,criteria:new Map<string,LibraryCriteria>()};
}
async function main(){
 const source=`
 import React,{useState} from 'react';import{createRoot}from'react-dom/client';
 import{WordbookLibrary}from'./src/features/wordbook-compositions/ui/wordbook-library';
 import{Button}from'./src/design-system/primitives/button/button';
 import{DialogFrame,DialogHeader,DialogBody}from'./src/design-system/primitives/dialog/dialog';
 import './src/styles/tokens.css';import './src/styles/theme.css';import './src/styles/reset.css';import './src/app/globals.css';
 import 'pretendard/dist/web/variable/pretendardvariable.css';
 window.__refreshCount=0;window.__refreshFailures=0;
 function App(){const[open,setOpen]=useState(false),[locked,setLocked]=useState(false);return <main style={{maxWidth:1100,margin:'16px auto',padding:16}}><Button onClick={()=>setOpen(true)}>단어장 만들기</Button>{open&&<DialogFrame size="extra-wide" aria-labelledby="m07-title" onRequestClose={()=>{if(!locked)setOpen(false)}}><DialogHeader closeLabel="닫기"><h2 id="m07-title">단어장 구성 확인</h2></DialogHeader><DialogBody><WordbookLibrary onBack={()=>setOpen(false)} onLockChange={setLocked} onLibraryChanged={async()=>{window.__refreshCount++;if(window.__refreshFailures-->0)throw Error('fake refresh failure')}} /></DialogBody></DialogFrame>}</main>};
 createRoot(document.getElementById('root')).render(<App/>);`;
 const bundled=await build({absWorkingDir:process.cwd(),tsconfig:"tsconfig.json",jsx:"automatic",nodePaths:[fs.realpathSync("node_modules")],stdin:{contents:source,resolveDir:process.cwd(),loader:"tsx"},outfile:"app.js",bundle:true,write:false,format:"iife",platform:"browser",loader:{".woff2":"dataurl"},define:{"process.env.NODE_ENV":'"production"',"process.env":"{}"},logLevel:"silent"});
 const js=bundled.outputFiles.find(f=>f.path.endsWith(".js"))!.contents,css=bundled.outputFiles.find(f=>f.path.endsWith(".css"))!.contents;
 const server=createServer((request,response)=>{if(request.url==="/app.js"){response.setHeader("content-type","application/javascript");response.end(js);}else if(request.url==="/app.css"){response.setHeader("content-type","text/css");response.end(css);}else if(request.url==="/"){response.setHeader("content-type","text/html; charset=utf-8");response.end('<!doctype html><html lang="ko"><meta name="viewport" content="width=device-width, initial-scale=1"><title>가짜 자료 화면 검사</title><link rel="stylesheet" href="/app.css"><body><div id="root"></div><script src="/app.js"></script></body></html>');}else{response.statusCode=404;response.end();}});
 await new Promise<void>(r=>server.listen(0,"127.0.0.1",r));const address=server.address();if(!address||typeof address==="string")throw Error("local address");const origin=`http://127.0.0.1:${address.port}`;
 const browser=await chromium.launch({headless:true}),output="docs/verification/APP-20261003-01_화면";fs.mkdirSync(output,{recursive:true});const evidence:unknown[]=[];
 try{
 for(const width of [1280,390]){
  const context=await browser.newContext({viewport:{width,height:900},reducedMotion:width===390?"reduce":"no-preference"});const page=await context.newPage(),errors:string[]=[],requests:unknown[]=[];page.on("pageerror",e=>{errors.push(e.message);console.error("Fake browser page:",e.message);});
  const f=fixtures();let failure=0,newId=400;
  await context.route("**/*",async route=>{
   const url=new URL(route.request().url());if(url.origin!==origin)return route.abort("blockedbyclient");
   if(!url.pathname.startsWith("/api/admin/wordbook-library/"))return route.continue();
   if(failure)return route.fulfill({status:failure,json:{}});
   if(url.pathname.endsWith("/query"))return route.fulfill({json:queryFixture(libraryQuerySchema.parse(route.request().postDataJSON()),f.catalog,f.criteria,f.kinds)});
   const c=libraryWriteCommandSchema.parse(route.request().postDataJSON());requests.push(c);
   if(c.action==="delete"){f.catalog.templates=f.catalog.templates.filter(t=>t.id!==c.templateId);return route.fulfill({json:{deleted:{templateId:c.templateId,revision:c.expectedRevision+1}}});}
   if(c.action==="materialize")throw Error("M07 browser does not create student exams");
   let t:LibraryTemplate;
   if(c.action==="create"){t={...structuredClone(f.catalog.templates[0]!),id:id(newId++),revision:1,metadata:c.metadata,versions:[{...f.catalog.templates[0]!.versions[0]!,id:id(newId++),recipe:c.recipe,contentHash:c.previewHash,sourceCount:c.recipe.scopes.length,includedKeys:c.recipe.scopes.map(s=>s.id===id(5)?"5".repeat(64):s.id===id(1)?"1".repeat(64):"2".repeat(64))}]};f.catalog.templates.unshift(t);}
   else{if(c.action!=="metadata")throw Error("Unexpected browser command "+c.action);t=f.catalog.templates.find(t=>t.id===c.templateId)!;t.metadata=c.metadata;t.revision++;}
   if("templateKind" in c)f.kinds.set(t.id,c.templateKind);return route.fulfill({json:{template:{id:t.id,revision:t.revision,metadata:t.metadata,templateKind:f.kinds.get(t.id)??null,latestVersion:versionSummary(t.versions[0]!)}}});
  });
  await page.goto(origin);await page.getByRole("button",{name:"단어장 만들기",exact:true}).click();await page.getByRole("heading",{name:metadata.title,exact:true}).waitFor();
  const overflow=async(label:string)=>{const sizes=await page.evaluate(()=>({viewport:innerWidth,html:document.documentElement.scrollWidth,body:document.body.scrollWidth,dialogs:[...document.querySelectorAll('[role="dialog"],[role="alertdialog"]')].map(e=>({client:e.clientWidth,scroll:e.scrollWidth}))}));expect(sizes.html).toBeLessThanOrEqual(width);expect(sizes.body).toBeLessThanOrEqual(width);for(const d of sizes.dialogs)expect(d.scroll).toBeLessThanOrEqual(d.client);evidence.push({width,label,sizes});};
  await overflow("저장 목록");await page.getByRole("button",{name:"템플릿 20개 더 보기"}).click();await page.getByRole("heading",{name:"가짜 목록 25",exact:true}).waitFor();
  await page.getByLabel("저장한 구성의 종류").selectOption("performance_assessment");await expect(page.getByRole("heading",{name:metadata.title,exact:true})).toHaveCount(0);await expect(page.getByRole("heading",{name:"가짜 목록 25",exact:true})).toBeVisible();
  await page.getByLabel("저장한 구성의 종류").selectOption("unclassified");const card=page.getByRole("article").filter({has:page.getByRole("heading",{name:metadata.title,exact:true})});await card.getByRole("button",{name:"구성 요약 보기"}).click();await page.getByRole("heading",{name:"저장한 구성",exact:true}).waitFor();await expect(page.getByLabel("시행연도 구간 시작")).toHaveCount(0);await overflow("미분류 요약");await page.screenshot({path:`${output}/${width}_요약.png`,fullPage:true});
  await page.getByRole("button",{name:"범위 수정",exact:true}).click();await page.getByRole("button",{name:/1. 저장된 개별 범위/}).waitFor();await expect(page.getByLabel("시행연도 구간 시작")).toHaveCount(0);
  await page.getByRole("button",{name:"모의고사 추가",exact:true}).click();await page.getByLabel("시행연도 구간 시작").waitFor();await overflow("자료 편집");
  await page.getByRole("button",{name:"범위 편집 닫기"}).click();await expect(page.getByLabel("시행연도 구간 시작")).toHaveCount(0);
  await page.getByRole("button",{name:"범위로 새로 만들기"}).click();await page.getByRole("button",{name:"계속 작성"}).waitFor();await page.keyboard.press("Escape");await expect(page.getByRole("button",{name:"범위로 새로 만들기"})).toBeFocused();
  await page.getByRole("button",{name:"범위로 새로 만들기"}).click();await page.getByRole("button",{name:"변경 내용을 버리고 이동"}).click();await expect(page.getByText("만들 단어장 종류를 골라 주세요.",{exact:true})).toBeVisible();
  await expect(page.locator('[role="alertdialog"]')).toHaveCount(0);
  const first=page.getByRole("tab",{name:"수행평가",exact:true});await expect(first).toHaveAttribute("tabindex","0");await first.focus();await expect(first).toBeFocused();await page.keyboard.press("ArrowRight");await expect(page.getByRole("tab",{name:"직전대비",exact:true})).toBeFocused();await expect(page.getByRole("tab",{name:"직전대비",exact:true})).toHaveAttribute("aria-selected","true");
  await page.getByLabel("템플릿 이름",{exact:true}).fill("가짜 긴 이름에서도 범위와 학교를 그대로 보존하는 구성");await page.getByLabel("학교",{exact:true}).fill("가짜 긴 학교명");await page.getByRole("button",{name:"모의고사 추가",exact:true}).click();await page.getByLabel("시행연도 구간 시작").waitFor();
  await page.getByRole("tab",{name:"기타",exact:true}).click();await expect(page.getByLabel("학교",{exact:true})).toHaveCount(0);await expect(page.getByLabel("시행연도 구간 시작")).toHaveCount(0);await page.getByRole("tab",{name:"수행평가",exact:true}).click();await expect(page.getByLabel("학교",{exact:true})).toHaveValue("가짜 긴 학교명");await overflow("종류 전환 초안");await page.screenshot({path:`${output}/${width}_작성.png`,fullPage:true});
  await page.getByRole("button",{name:"템플릿 저장",exact:true}).click();await page.getByText("템플릿을 저장했습니다.",{exact:true}).waitFor();await page.getByLabel("저장한 구성의 종류").selectOption("all");await page.getByRole("heading",{name:"가짜 긴 이름에서도 범위와 학교를 그대로 보존하는 구성",exact:true}).waitFor();
  const newCard=page.getByRole("article").filter({has:page.getByRole("heading",{name:"가짜 긴 이름에서도 범위와 학교를 그대로 보존하는 구성",exact:true})});await expect(newCard).toContainText("수행평가");await newCard.getByRole("button",{name:"이름·종류·대상 수정"}).click();await page.getByLabel("템플릿 이름",{exact:true}).fill("표시만 변경");
  await page.evaluate(()=>{(window as unknown as {__refreshFailures:number}).__refreshFailures=1;});await page.getByRole("button",{name:"템플릿 저장",exact:true}).click();await page.getByText("저장은 완료됐습니다. 목록 갱신을 다시 확인해 주세요.",{exact:true}).waitFor();const sent=requests.length;await page.getByRole("button",{name:"같은 내용으로 저장 확인"}).click();await expect(page.getByRole("button",{name:"같은 내용으로 저장 확인"})).toHaveCount(0);expect(requests.length).toBe(sent);await overflow("저장 확정 뒤 복구");
  await page.getByRole("button",{name:"저장한 템플릿 찾기"}).click();await page.getByLabel("저장한 구성의 종류").selectOption("all");const del=page.getByRole("article").filter({has:page.getByRole("heading",{name:"표시만 변경",exact:true})}).getByRole("button",{name:"템플릿 삭제"});await del.click();await overflow("삭제 확인");await page.getByRole("button",{name:"취소",exact:true}).click();await expect(del).toBeFocused();
  failure=503;await page.getByLabel("템플릿 검색").fill("오류 검사");await page.getByText("자료를 불러오지 못했습니다. 다시 시도해 주세요.",{exact:true}).waitFor();await expect(page.getByText("이 조건에 맞는 템플릿이 없습니다.",{exact:true})).toHaveCount(0);await overflow("조회 실패");await page.screenshot({path:`${output}/${width}_오류.png`,fullPage:true});
  failure=0;await page.getByRole("button",{name:"다시 불러오기"}).click();await page.getByText("이 조건에 맞는 템플릿이 없습니다.",{exact:true}).waitFor();
  if(width===390){const motion=await page.evaluate(()=>({reduced:matchMedia('(prefers-reduced-motion: reduce)').matches,durations:[...document.querySelectorAll('button')].map(e=>getComputedStyle(e).transitionDuration)}));expect(motion.reduced).toBe(true);expect(motion.durations.every(d=>d.split(',').every(t=>parseFloat(t)===0))).toBe(true);evidence.push({width,motion});}
  failure=401;await page.getByLabel("템플릿 검색").fill("권한 검사");await page.getByRole("button",{name:"로그인 후 다시 확인"}).waitFor();await expect(page.getByLabel("템플릿 검색")).toHaveCount(0);expect(errors).toEqual([]);
  evidence.push({width,commands:requests,callbackRetries:await page.evaluate(()=>(window as unknown as {__refreshCount:number}).__refreshCount),pageErrors:errors});await context.close();
 }
 const result={task:"APP-20261003-01",at:new Date().toISOString(),environment:"isolated loopback React harness with actual application CSS; fake HTTP data only",productionWrites:0,evidence,files:fs.readdirSync(output).filter(n=>n.endsWith('.png')).map(name=>({name,sha256:createHash('sha256').update(fs.readFileSync(`${output}/${name}`)).digest('hex')}))};
 fs.writeFileSync(`${output}/결과.json`,JSON.stringify(result,null,2)+"\n");console.log(JSON.stringify({passed:true,widths:[1280,390],checks:evidence.length,screenshots:result.files.length}));
 }finally{await browser.close();await new Promise<void>(r=>server.close(()=>r()));}
}
main().catch(e=>{console.error(e);process.exitCode=1;});
