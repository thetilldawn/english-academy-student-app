// Local fake UI only. Real APIs are blocked; no credentials or student records.
import path from "node:path";
import { realpathSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { createServer } from "vite";
if(process.env.VERCEL) throw new Error("로컬 검사 전용");
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),"..");
const entry="/__dashboard-fixture.jsx";
const fixture=`
import React,{useState} from "react";
import {createRoot} from "react-dom/client";
import {StudentDashboard} from "@/features/student-dashboard/ui/student-dashboard";
import {AssignmentQueueTags} from "@/features/assignment-queue/ui/assignment-queue-tags";
import {SessionLogoutBoundary} from "@/features/session/public-client";
import {StudentLogoutButton} from "@/components/student-logout-button";
import {AdminLogoutButton} from "@/components/admin-logout-button";
import "pretendard/dist/web/variable/pretendardvariable.css";
import "@/styles/tokens.css";import "@/styles/theme.css";import "@/styles/reset.css";
const stamp=new Date().toISOString();let mode="success",calls=0;
const role=location.pathname==="/admin"?"admin":"student";
const scope=Array.from({length:25},(_,i)=>"2024년 3월 · 모의고사 · 주장 ["+(i+20)+"번]").join(" · ");
const item=(section,i)=>({
 id:section+"-"+i,assignmentStatus:"active",displayTitle:"",datasetTitle:"고3 2024~2025 모의고사",assignmentPurpose:"regular",
 scopeLabel:i===0?scope:"DAY "+(i+1),questionCount:20,passingScore:80,retakeAllowed:true,
 lastAttemptId:section==="needs_attention"||section==="completed"?"fake-"+i:null,
 lastStatus:section==="needs_attention"||section==="completed"?"completed":null,lastPhase:section==="needs_attention"||section==="completed"?"completed":null,
 lastInitialScore:section==="needs_attention"?50:section==="completed"?100:null,
 lastFinalScore:section==="needs_attention"?50:section==="completed"?100:null,
 lastPassed:section==="needs_attention"?false:section==="completed"?true:null,
 lastRetryStartedAt:null,lastStartedAt:null,lastInitialCompletedAt:null,
 lastCompletedAt:section==="needs_attention"||section==="completed"?new Date(Date.parse(stamp)-i*60000).toISOString():null,
 lastDeadlineAt:null,lastUnresolvedWrongCount:null,assignedAt:stamp,
 availableFrom:section==="scheduled"?new Date(Date.parse(stamp)+86400000).toISOString():null,availableUntil:null,missedAt:null
});
const keys=["open","scheduled","needs_attention","completed"];
const page=(section,offset=0)=>({items:Array.from({length:Math.min(10,21-offset)},(_,i)=>item(section,offset+i)),nextCursor:offset+10<21?section+":"+(offset+10):null});
const snapshot={snapshotAt:stamp,currentAssignments:keys.filter(s=>s!=="completed").flatMap(section=>page(section).items.map(assignment=>({section,assignment}))),
 currentCursors:{open:"open:10",scheduled:"scheduled:10",needs_attention:"needs_attention:10",deadline_closed:null},
 completedPage:page("completed"),sectionCounts:{open:21,scheduled:21,needs_attention:21,completed:21,deadline_closed:0}};
window.fetch=async(url,options)=>{
 if(url==="/api/admin/session"||url==="/api/student/session"){
   calls++; await new Promise(r=>setTimeout(r,mode==="slow"?12000:300));
   return Response.json({}, {status:mode==="fail"?503:200});
 }
 if(url==="/api/student/dashboard/sections"||url==="/api/student/dashboard/completed"){
   const [section,offset]=JSON.parse(options.body).cursor.split(":");
   return Response.json({page:page(section,Number(offset))});
 }
 throw new Error("실제 API/외부 요청 금지");
};
function Fixture(){
 const [width,setWidth]=useState("100%");return <div style={{maxWidth:width,margin:"auto"}}>
 <p>가짜 자료 화면 검사 · 학생 기록과 연결되지 않음</p>
 <button onClick={()=>setWidth("390px")}>모바일 폭</button><button onClick={()=>setWidth("100%")}>PC 폭</button>
 <button onClick={()=>mode="slow"}>느린 종료</button><button onClick={()=>mode="fail"}>종료 실패</button><button onClick={()=>mode="success"}>정상 종료</button>
 <SessionLogoutBoundary role={role}><header style={{padding:20}}>가짜 학생 · 개인 점수 {role==="admin"?<AdminLogoutButton/>:<StudentLogoutButton/>}</header>
 {role==="admin"?<section style={{padding:20}}><h2>배정된 시험 머리</h2><div style={{display:"flex",width:"100%"}}><AssignmentQueueTags compact queue={{status:"completed",attentionReason:null,unitAllocation:null,datasetLabel:"고3 모의고사",rangeLabel:scope,remainingSessionCount:2,remainingQuestionCount:40}}/><span>▾</span></div></section>:null}
 <StudentDashboard snapshot={snapshot}/></SessionLogoutBoundary></div>;
}
createRoot(document.getElementById("root")).render(<Fixture/>);
`;
const server=await createServer({
 root,configFile:false,envDir:false,logLevel:"warn",server:{host:"127.0.0.1",port:3037,strictPort:true,
   fs:{allow:[root,realpathSync(path.join(root,"node_modules"))]}},
 oxc:{jsx:{runtime:"automatic"}},optimizeDeps:{noDiscovery:true,include:["react","react-dom/client","react-dom","react/jsx-runtime","react/jsx-dev-runtime","zod"]},
 resolve:{alias:{"@":path.join(root,"src")}},plugins:[{name:"local-dashboard-fixture",enforce:"pre",
 resolveId(source){if(source===entry)return entry;if(source==="next/link")return "/__link.jsx";if(source==="next/navigation")return "/__nav.js";},
 load(id){if(id===entry)return fixture;if(id==="/__link.jsx")return 'import React from "react";export default function Link({href,children,prefetch,scroll,replace,...props}){return <a href={href} {...props}>{children}</a>}';
 if(id==="/__nav.js")return 'export function useRouter(){return {refresh(){},replace(){},push(){}}} export function usePathname(){return location.pathname} export function useSelectedLayoutSegments(){return ["students"]}';},
 configureServer(vite){vite.middlewares.use((req,res,next)=>{
 if(req.url?.startsWith("/api/")){res.statusCode=403;res.end("실제 API 금지");return;}
 if(["/","/student","/admin"].includes(req.url)){
 res.setHeader("content-type","text/html;charset=utf-8");
 res.end('<!doctype html><html lang="ko" data-theme="dark"><head><meta name="viewport" content="width=device-width,initial-scale=1"><title>시험 목록 로컬 검사</title></head><body>'+(req.url==="/"?'<h1>접속 화면</h1><a href="/student">학생 검사</a> <a href="/admin">관리자 검사</a>':'<div id="root"></div><script type="module" src="'+entry+'"></script>')+'</body></html>');return;}next();});}
 }]});
await server.listen();console.log("http://127.0.0.1:3037/student · 가짜 자료/실제 API 차단");
for(const signal of ["SIGINT","SIGTERM"]) process.once(signal,async()=>{await server.close();process.exit(0);});
