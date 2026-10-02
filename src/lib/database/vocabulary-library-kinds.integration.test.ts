import { randomUUID } from "node:crypto";
import type { PGlite } from "@electric-sql/pglite";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createFinalSchemaDatabase } from "@/test-support/final-schema-database";
import { TEMPLATE_KINDS, type TemplateKind } from "@/lib/admin/dataset-catalog";
import { EMPTY_LIBRARY_FILTERS } from "@/features/wordbook-compositions/contracts/library";
import { libraryCommandV3ResultSchema } from "@/features/wordbook-compositions/contracts/library-v3";

const actor="a6070000-0000-4000-8000-000000000001",other="a6070000-0000-4000-8000-000000000002";
const metadata={title:"가짜 분류 구성",tags:[],school:null,targetGrade:null,schoolYear:null,semester:null,assessment:null,purpose:"옛 자유 설명"};
const recipe={filters:EMPTY_LIBRARY_FILTERS,scopes:[],excludedOccurrenceKeys:[],scopeStatus:"unconfirmed"};
describe.sequential("공식 단어장 종류와 기존 저장 계약 보존",()=>{
 let db:PGlite;
 const scalar=async<T>(sql:string,args:unknown[]=[])=>(await db.query<{v:T}>(sql,args)).rows[0]!.v;
 const admin=async(id=actor)=>db.exec(`reset role;set role authenticated;select set_config('request.jwt.claim.sub','${id}',true);select set_config('request.jwt.claim.role','authenticated',true)`);
 const owner=()=>db.exec("reset role");
 const raw=(request:unknown,version=3)=>scalar<Record<string,unknown>>(`select public.save_vocabulary_library_template_v${version}($1::jsonb) v`,[JSON.stringify(request)]);
 const save=async(request:unknown)=>libraryCommandV3ResultSchema.parse(await raw(request));
 async function make(kind:TemplateKind="other",title=metadata.title){
   const hash=await scalar<string>("select private.reviewed_exam_sha256_v1(private.resolve_vocabulary_library_recipe_compact_v1($1::jsonb)) v",[JSON.stringify(recipe)]);
   return {action:"create",protocolVersion:3,templateKind:kind,requestId:randomUUID(),metadata:{...metadata,title},recipe,criteria:null,previewHash:hash};
 }
 async function create(kind:TemplateKind="other",title=metadata.title){await owner();const request=await make(kind,title);await admin();return {request,result:await save(request)};}
 async function query(kind:string,cursor:unknown=null,search=""){return scalar<{items:{id:string;templateKind:TemplateKind|null}[];nextCursor:unknown}>("select public.query_vocabulary_library_v2($1::jsonb) v",[JSON.stringify({kind:"templates",search,templateKind:kind,cursor,limit:20})]);}
 async function fails(action:()=>Promise<unknown>,message:string){
   await db.exec("savepoint expected_failure");try{await expect(action()).rejects.toThrow(message);}finally{await db.exec("rollback to expected_failure;release expected_failure");}
 }
 beforeAll(async()=>{db=await createFinalSchemaDatabase();await db.exec(`insert into auth.users(id)values('${actor}'),('${other}');insert into public.admin_profiles(user_id,display_name)values('${actor}','가짜 관리자'),('${other}','다른 가짜 관리자')`);},120000);
 beforeEach(async()=>{await db.exec("begin");});
 afterEach(async()=>{await db.exec("rollback;reset role");});
 afterAll(async()=>{await db?.close();});

 it("round-trips all four explicit kinds and never derives them from free text",async()=>{
   for(const kind of TEMPLATE_KINDS){
     const {result}=await create(kind);expect(result.template.templateKind).toBe(kind);expect(result.template.metadata.purpose).toBe("옛 자유 설명");
     expect((await query(kind)).items.map(t=>t.id)).toContain(result.template.id);
     const detail=await scalar<{template:{templateKind:TemplateKind}}>("select public.query_vocabulary_library_v2($1::jsonb) v",[JSON.stringify({kind:"detail",templateId:result.template.id})]);
     expect(detail.template.templateKind).toBe(kind);
   }
   expect((await query("unclassified")).items).toHaveLength(0);
 });
 it("retains old request receipts exactly and keeps unclassified separate from other",async()=>{
   await owner();const input=await make();const {protocolVersion:_,templateKind:__,...old}=input;void _;void __;await admin();
   const oldResult=await raw(old,2);expect((await query("unclassified")).items).toHaveLength(1);expect((await query("other")).items).toHaveLength(0);
   expect(JSON.stringify(oldResult)).not.toContain("templateKind");
   const t=oldResult.template as {id:string;revision:number};
   await save({action:"metadata",protocolVersion:3,templateKind:"performance_assessment",requestId:randomUUID(),templateId:t.id,expectedRevision:t.revision,metadata});
   expect(await raw(old,2)).toEqual(oldResult);
   expect((await query("performance_assessment")).items[0]?.id).toBe(t.id);
 });
 it("binds full kind and protocol to a receipt before current revision checks",async()=>{
   const {request,result}=await create("performance_assessment");
   await save({action:"metadata",protocolVersion:3,templateKind:"mock_exam",requestId:randomUUID(),templateId:result.template.id,expectedRevision:1,metadata});
   expect(await save(request)).toEqual(result);
   await fails(()=>save({...request,templateKind:"exam_prep"}),"library_request_reused");
   await fails(()=>raw({...request,protocolVersion:2}),"invalid_library_template_kind");
 });
 it("changes metadata only and old editors cannot erase a confirmed kind",async()=>{
   const {result}=await create("exam_prep");await owner();
   const before=await scalar<string>("select md5(jsonb_agg(to_jsonb(v)order by id)::text) v from private.vocabulary_library_versions v");
   await admin();
   await raw({action:"metadata",requestId:randomUUID(),templateId:result.template.id,expectedRevision:1,metadata:{...metadata,title:"옛 화면에서 이름 수정"}},2);
   expect((await query("exam_prep")).items[0]?.id).toBe(result.template.id);
   await save({action:"metadata",protocolVersion:3,templateKind:"other",requestId:randomUUID(),templateId:result.template.id,expectedRevision:2,metadata});
   await owner();expect(await scalar<string>("select md5(jsonb_agg(to_jsonb(v)order by id)::text) v from private.vocabulary_library_versions v")).toBe(before);
   await admin();await fails(()=>save({action:"metadata",protocolVersion:3,templateKind:null,requestId:randomUUID(),templateId:result.template.id,expectedRevision:3,metadata}),"classified_template_kind_required");
 });
 it("allows existing null metadata edits but rejects missing kind in new create and copy",async()=>{
   await owner();const input=await make();const {protocolVersion:_,templateKind:__,...old}=input;void _;void __;await admin();
   const t=(await raw(old,2)).template as {id:string;latestVersion:{id:string}};
   const edited=await save({action:"metadata",protocolVersion:3,templateKind:null,requestId:randomUUID(),templateId:t.id,expectedRevision:1,metadata});
   expect(edited.template.templateKind).toBeNull();
   await fails(()=>raw({...input,requestId:randomUUID(),templateKind:null}),"invalid_library_template_kind");
   await fails(()=>raw({action:"copy",protocolVersion:3,templateKind:null,requestId:randomUUID(),sourceVersionId:t.latestVersion.id,metadata}),"invalid_library_template_kind");
   await fails(()=>raw({...input,requestId:randomUUID(),templateKind:"performance"}),"invalid_library_template_kind");
 });
 it("filters before the page limit and rejects a cursor for another filter or actor",async()=>{
   for(let i=0;i<27;i++){await create("mock_exam","가짜 목록 "+i);if(i%3===0)await create("other","가짜 다른 목록 "+i);}
   const first=await query("mock_exam");expect(first.items).toHaveLength(20);expect(first.items.every(t=>t.templateKind==="mock_exam")).toBe(true);
   const next=await query("mock_exam",first.nextCursor);expect(next.items).toHaveLength(7);expect(next.nextCursor).toBeNull();
   expect(new Set([...first.items,...next.items].map(t=>t.id)).size).toBe(27);
   await fails(()=>query("other",first.nextCursor),"library_cursor_changed");
   await fails(()=>query("mock_exam",first.nextCursor,"다른 조건"),"library_cursor_changed");
   await admin(other);await fails(()=>query("mock_exam",first.nextCursor),"library_cursor_changed");
 });
 it("keeps an unresolved template readable and prevents actual generation",async()=>{
   const {result}=await create("other");
   expect(result.template.latestVersion.scopeStatus).toBe("unconfirmed");
   await fails(()=>scalar("select public.advance_vocabulary_template_book_v1($1::jsonb) v",[JSON.stringify({action:"materialize",requestId:randomUUID(),templateId:result.template.id,versionId:result.template.latestVersion.id,contentHash:result.template.latestVersion.contentHash})]),"unconfirmed");
 });
 it("does not give anonymous, service or nonadmin actors the new operations",async()=>{
   for(const role of ["anon","service_role","authenticated"]){await owner();await db.exec(`set role ${role};select set_config('request.jwt.claim.sub','a6070000-0000-4000-8000-000000000099',true)`);
     await fails(()=>query("all"),role==="authenticated"?"admin_required":"permission denied");
     await fails(()=>raw({}),role==="authenticated"?"admin_required":"permission denied");
     await fails(()=>scalar("select public.get_vocabulary_composition_summary_v3($1) v",[randomUUID()]),role==="authenticated"?"admin_required":"permission denied");
   }
 });
 it("preserves v1 and v3 receipts through classification, new versions and deletion",async()=>{
   await admin();
   const old={action:"create",requestId:randomUUID(),metadata,recipe};
   const receipt=await raw(old,1), legacy=receipt.template as {id:string;revision:number;versions:{id:string;contentHash:string}[]};
   const classify={action:"metadata",protocolVersion:3,templateKind:"mock_exam",requestId:randomUUID(),templateId:legacy.id,expectedRevision:1,metadata};
   const classified=await save(classify), v=classified.template.latestVersion;
   const updated=await save({action:"version",protocolVersion:3,templateKind:"other",requestId:randomUUID(),templateId:legacy.id,expectedRevision:2,expectedContentHash:v.contentHash,metadata,recipe,criteria:null,previewHash:v.contentHash});
   expect(updated.template.latestVersion.number).toBe(2);
   const copy=await save({action:"copy",protocolVersion:3,templateKind:"performance_assessment",requestId:randomUUID(),sourceVersionId:v.id,metadata});
   expect(copy.template.latestVersion.sourceVersionId).toBe(v.id);expect(copy.template.templateKind).toBe("performance_assessment");
   await raw({action:"version",requestId:randomUUID(),templateId:legacy.id,expectedRevision:3,expectedContentHash:v.contentHash,metadata,recipe,criteria:null,previewHash:v.contentHash},2);
   await raw({action:"version",requestId:randomUUID(),templateId:legacy.id,expectedRevision:4,expectedContentHash:v.contentHash,metadata,recipe},1);
   expect((await query("other")).items.map(t=>t.id)).toContain(legacy.id);
   await raw({action:"delete",requestId:randomUUID(),templateId:legacy.id,expectedRevision:5},2);
   expect(await raw(old,1)).toEqual(receipt);expect(await save(classify)).toEqual(classified);
   await fails(()=>save({action:"copy",protocolVersion:3,templateKind:"other",requestId:randomUUID(),sourceVersionId:v.id,metadata}),"library_template_not_found");
 });
});
