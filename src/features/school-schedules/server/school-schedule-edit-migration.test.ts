import fs from "node:fs";
import { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, expect, it } from "vitest";
import { fakeSchoolBundle as bundle } from "../school-schedule.fixture";
import { scheduleEditorSnapshotSchema } from "../contracts/school-schedule-edit";
import { schoolScheduleBundleSchema } from "../contracts/school-schedule";
const original = fs.readFileSync("supabase/migrations/20260913092302_add_school_schedule_and_student_school_key.sql","utf8");
const migration = fs.readFileSync("supabase/migrations/20260913221810_add_school_schedule_manual_edits.sql","utf8");
let db: PGlite;
const student = "00000000-0000-4000-8000-000000000001";
const actor = "00000000-0000-4000-8000-000000000099";
const requestId = "00000000-0000-4000-8000-000000000501";
const manualEvent = { ...bundle.events[1], startDate: "2026-09-22", endDate: "2026-09-22", precision: "day", status: "confirmed", applicability: "grade", sourceUrl: null, sourceLabel: "관리자 수동 입력" };
const command = { requestId, schoolKey: bundle.schoolKey, academicYear: 2026, semester: 2, sourceVersionId: bundle.versionId, manualRevision: 0, event: manualEvent };
const save = (value: unknown) => db.query<{v:{revision:number;eventId:string}}>("select public.save_admin_school_schedule_event_v1($1::jsonb) v",[JSON.stringify(value)]);
const read = async (key=bundle.schoolKey) => (await db.query<{v:unknown}>("select public.get_admin_school_schedule_editor_v1($1,2026,2) v",[key])).rows[0].v;
const register = (value: unknown) => db.query("select public.register_school_schedule_v1($1::jsonb)",[JSON.stringify(value)]);
beforeAll(async () => {
  db = new PGlite();
  await db.exec("create role anon; create role authenticated; create role service_role; create schema private; create schema auth;");
  await db.exec("create function private.is_active_admin() returns boolean language sql stable as $$ select coalesce(current_setting('test.admin',true),'')='yes' $$; create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('test.actor',true),'')::uuid $$;");
  await db.exec("create table public.students(id uuid primary key,school_key text,school_name text,grade_label text,status text default 'active',deleted_at timestamptz);");
  await db.query("insert into students(id,school_key,school_name,grade_label) values($1,$2,'가상고등학교','고2')",[student,bundle.schoolKey]);
  await db.exec("set test.admin='yes'; set test.actor='" + actor + "';");
  const sourceTable=original.slice(original.indexOf("create table private.school_schedule_versions"),original.indexOf("create or replace function private.get_admin_student_profile"));
  const readAndRegister=original.slice(original.indexOf("create function private.school_schedule_payload"));
  await db.exec("begin;\n"+sourceTable+"\n"+readAndRegister);
  await db.exec(migration); await register(bundle);
},30000);
afterAll(async()=>{ await db?.close(); });
it("원천 날짜는 유지하고 수동 변경은 관리자와 본인 조회에 같이 전달한다",async()=>{
  const before=(await db.query("select payload from private.school_schedule_versions")).rows;
  const result=await save(command); expect(result.rows[0].v.eventId).toBe(manualEvent.id);
  const snapshot=scheduleEditorSnapshotSchema.parse(await read());
  expect(snapshot.events.find(e=>e.id===manualEvent.id)?.startDate).toBe("2026-09-22");
  expect(snapshot.manualRevision).toBe(result.rows[0].v.revision);
  expect(snapshot.sourceChangedEventIds).toEqual([]);
  expect((await db.query("select payload from private.school_schedule_versions")).rows).toEqual(before);
  const admin=(await db.query<{v:{bundles:unknown[]}}>("select public.get_admin_school_schedules_v1(null) v")).rows[0].v;
  const own=(await db.query<{v:{bundles:unknown[];students:{id:string}[]}}>("select public.get_student_school_schedule_v1($1) v",[student])).rows[0].v;
  expect(own.bundles).toEqual(admin.bundles); expect(own.students.map(s=>s.id)).toEqual([student]);
  expect(schoolScheduleBundleSchema.parse(own.bundles[0]).events.find(e=>e.id===manualEvent.id)?.sourceLabel).toBe("관리자 수동 입력");
});
it("응답을 잃은 동일 요청은 이전 버전이어도 같은 영수증이며 다른 내용·저장자는 거절한다",async()=>{
  const first=await save(command); const again=await save(command); expect(again.rows).toEqual(first.rows);
  expect((await db.query("select count(*)::integer n from private.school_schedule_manual_edits")).rows).toEqual([{n:1}]);
  await expect(save({...command,event:{...manualEvent,title:"다른 내용"}})).rejects.toThrow("schedule_request_conflict");
  await db.exec("set test.actor='00000000-0000-4000-8000-000000000098'");
  await expect(save(command)).rejects.toThrow("schedule_request_conflict");
  expect((await db.query<{v:unknown}>("select public.get_admin_school_schedule_edit_result_v1($1) v",[requestId])).rows[0].v).toBeNull();
  await db.exec("set test.actor='"+actor+"'");
  expect((await db.query<{v:{requestId:string}}>("select public.get_admin_school_schedule_edit_result_v1($1) v",[requestId])).rows[0].v.requestId).toBe(requestId);
});
it("새 수동 입력과 원천 교체 모두 이전 모달 저장을 충돌 처리하고 수동 내용은 유지한다",async()=>{
  await expect(save({...command,requestId:"00000000-0000-4000-8000-000000000502"})).rejects.toThrow("school_schedule_conflict");
  const before=scheduleEditorSnapshotSchema.parse(await read());
  await register({...bundle,versionId:"fake-v2",sourceHash:"b".repeat(64),events:[bundle.events[0]]});
  await expect(save({...command,requestId:"00000000-0000-4000-8000-000000000503",manualRevision:before.manualRevision})).rejects.toThrow("school_schedule_conflict");
  const after=scheduleEditorSnapshotSchema.parse(await read());
  expect(after.sourceChangedEventIds).toContain(manualEvent.id);
  expect(after.events.find(e=>e.id===manualEvent.id)?.startDate).toBe("2026-09-22");
});
it("원천 없는 연결 학교도 새 일정 입력이 가능하며 원천 버전을 위조하지 않는다",async()=>{
  const key="J10:8888888";
  await db.query("insert into students(id,school_key,school_name,grade_label) values('00000000-0000-4000-8000-000000000002',$1,'다른 가상고','고1')",[key]);
  const empty=scheduleEditorSnapshotSchema.parse(await read(key)); expect(empty.sourceVersionId).toBeNull(); expect(empty.events).toEqual([]);
  await save({...command,requestId:"00000000-0000-4000-8000-000000000504",schoolKey:key,sourceVersionId:null,event:{...manualEvent,grade:1,id:"manual:00000000-0000-4000-8000-000000000504"}});
  const next=scheduleEditorSnapshotSchema.parse(await read(key)); expect(next.sourceVersionId).toBeNull(); expect(next.events).toHaveLength(1);
  expect((await db.query<{n:number}>("select count(*)::integer n from private.school_schedule_versions where school_key=$1",[key])).rows[0].n).toBe(0);
  const raw=(await db.query<{v:unknown}>("select private.effective_school_schedule_bundle($1,2026,2) v",[key])).rows[0].v;
  expect(schoolScheduleBundleSchema.parse(raw).versionId).toMatch(/^manual:/);
});
it("잘못된 날짜·정밀도·추가 필드·학교·학년은 이력을 만들지 못한다",async()=>{
  const current=scheduleEditorSnapshotSchema.parse(await read());
  const base={...command,requestId:"00000000-0000-4000-8000-000000000505",sourceVersionId:current.sourceVersionId,manualRevision:current.manualRevision};
  const count=async()=>(await db.query("select count(*) n from private.school_schedule_manual_edits")).rows;
  const before=await count();
  for(const event of [{...manualEvent,startDate:"2026-02-31",endDate:"2026-02-31"},{...manualEvent,title:" "},{...manualEvent,precision:"unknown"},
    {...manualEvent,kind:"csat"},{...manualEvent,grade:3},{...manualEvent,sourceUrl:"https://school.example.invalid"},{...manualEvent,extra:1}]) {
    await expect(save({...base,event})).rejects.toThrow();
  }
  await expect(save({...base,schoolKey:"J10:7777777"})).rejects.toThrow("school_scope_not_found");
  expect(await count()).toEqual(before);
});
it("학생·익명·서비스 역할은 수동 저장을 실행할 수 없고 관리자만 엄격하게 읽는다",async()=>{
  for(const role of ["anon","service_role"]) {
    await db.exec("set role "+role);
    try { await expect(save(command)).rejects.toThrow(); await expect(read()).rejects.toThrow(); }
    finally { await db.exec("reset role"); }
  }
  await db.exec("set test.admin='no'; set role authenticated");
  try { await expect(save(command)).rejects.toThrow("forbidden"); await expect(read()).rejects.toThrow("forbidden"); }
  finally { await db.exec("reset role; set test.admin='yes'"); }
  await db.exec("set role authenticated");
  try {
    expect(scheduleEditorSnapshotSchema.parse(await read()).groups[0].studentCount).toBe(1);
    await expect(db.query("select * from private.school_schedule_manual_edits")).rejects.toThrow();
  } finally { await db.exec("reset role"); }
});
it("새 원천과 수동본의 합계가 계약 한도를 넘으면 원천 교체를 통째로 되돌린다",async()=>{
  const before=scheduleEditorSnapshotSchema.parse(await read());
  await expect(register({...bundle,versionId:"too-many-combined",events:Array.from({length:300},(_,i)=>({...bundle.events[0],id:"new-"+i}))})).rejects.toThrow("schedule_effective_limit");
  expect(scheduleEditorSnapshotSchema.parse(await read())).toEqual(before);
});
