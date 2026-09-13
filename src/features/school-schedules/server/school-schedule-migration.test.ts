import fs from "node:fs";
import { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, expect, it } from "vitest";
import { fakeSchoolBundle as bundle } from "../school-schedule.fixture";
const migration = fs.readFileSync("supabase/migrations/20260913092302_add_school_schedule_and_student_school_key.sql","utf8");
const profileMigration = fs.readFileSync("supabase/migrations/20260831101000_add_student_profile_version_command.sql","utf8");
let db: PGlite;
const id = "00000000-0000-4000-8000-000000000001";
beforeAll(async () => {
  db = new PGlite();
  await db.exec(`
    create role anon; create role authenticated; create role service_role;
    create schema private; create schema auth;
    create function private.is_active_admin() returns boolean language sql stable as $$ select coalesce(current_setting('test.admin',true),'')='yes' $$;
    create function auth.uid() returns uuid language sql stable as $$ select '00000000-0000-4000-8000-000000000099'::uuid $$;
    create table public.students(id uuid primary key default gen_random_uuid(),display_name text not null,school_name text,grade_label text,
      status text default 'active',updated_at timestamptz default '2026-09-01Z',deleted_at timestamptz);
    create table public.audit_events(event_type text check(event_type<>'reject'),actor_admin_id uuid,student_id uuid,details jsonb);
    create table public.student_codes(student_id uuid,code text);
    create function public.get_admin_student_detail_initial_v1(p_student_id uuid,p_snapshot_at timestamptz default null)
    returns jsonb language sql stable as $$ select jsonb_build_object('snapshotAt',coalesce(p_snapshot_at,statement_timestamp()),'student',jsonb_build_object('id',id,'displayName',display_name,'schoolName',school_name,'gradeLabel',grade_label)) from public.students where id=p_student_id and deleted_at is null $$;
    create function public.create_student_with_code_v2(p_display_name text,p_school_name text,p_grade_label text,p_current_vocab_dataset_id uuid,p_note text,p_lookup_hmac text,p_encrypted_code text,p_encryption_iv text,p_encryption_tag text)
    returns table(student_id uuid,code_generation integer) language plpgsql security definer set search_path='' as $$
    declare new_id uuid;
    begin
      if not private.is_active_admin() then raise exception 'forbidden' using errcode='42501'; end if;
      if p_current_vocab_dataset_id is not null then raise exception 'dataset_not_ready'; end if;
      insert into public.students(display_name,school_name,grade_label) values(p_display_name,p_school_name,p_grade_label) returning id into new_id;
      insert into public.student_codes values(new_id,p_encrypted_code);
      if p_encrypted_code='fail' then raise exception 'code_failed'; end if;
      return query select new_id,1;
    end $$;
    insert into public.students(id,display_name,school_name,grade_label) values('${id}','가상 학생','가상고등학교','고2');
    set test.admin='yes';
  `);
  await db.exec(profileMigration);
  await db.exec(migration);
}, 30000);
afterAll(async () => { await db?.close(); });
const snapshot = async () => (await db.query<{value:{updatedAt:string;schoolKey:string|null;schoolName:string}}>("select public.get_admin_student_profile_v1($1) as value",[id])).rows[0].value;
const register = (payload: unknown) => db.query("select public.register_school_schedule_v1($1::jsonb)",[JSON.stringify(payload)]);
it("新 nullable 열만 추가하며 이전 학생 값과 시간이 그대로다", async () => {
  const row=(await db.query<{school_key:null;updated_at:Date}>("select school_key,updated_at from students where id=$1",[id])).rows[0];
  expect(row.school_key).toBeNull(); expect(new Date(row.updated_at).toISOString()).toBe("2026-09-01T00:00:00.000Z");
});
it("반복 등록은 멱등이고 잘못된 새 버전은 이전 현재본을 대체하지 못한다", async () => {
  await register(bundle); await register(bundle);
  const badEvents=[{...bundle.events[0],precision:"bogus"},{...bundle.events[0],grade:null},{...bundle.events[1],startDate:"2026-09-13"},
    {...bundle.events[0],sourceUrl:"https://%"},{...bundle.events[0],sourceUrl:"https://[invalid"},{...bundle.events[0],sourceUrl:"https://999.999.999.999"},
    {...bundle.events[0],sourceUrl:null},{...bundle.events[0],sourceUrl:null,sourceLabel:" \t "},{...bundle.events[0],sourceLabel:"\t"},
    {...bundle.events[0],sourceUrl:null,sourceLabel:3},{...bundle.events[0],sourceUrl:null,sourceLabel:"학교 배부 안내문",unexpected:true}];
  for (const event of badEvents) await expect(register({...bundle,versionId:"bad",events:[event]})).rejects.toThrow();
  await expect(register({...bundle,versionId:"bad",events:[bundle.events[0],bundle.events[0]]})).rejects.toThrow();
  await expect(register({...bundle,versionId:"bad",checkedOn:"2026-02-31"})).rejects.toThrow();
  const numericHash = JSON.stringify({...bundle,versionId:"bad"}).replace(/"sourceHash":"[a-f0-9]{64}"/, '"sourceHash":'+'1'.repeat(64));
  await expect(db.query("select public.register_school_schedule_v1($1::jsonb)",[numericHash])).rejects.toThrow();
  await expect(register({...bundle,sourceHash:"b".repeat(64)})).rejects.toThrow("schedule_version_conflict");
  const rows=(await db.query("select version_id,is_current from private.school_schedule_versions")).rows;
  expect(rows).toEqual([{version_id:bundle.versionId,is_current:true}]);
});
it("학교키만 바꾸어도 정밀 버전이 증가하고 같은 버전 재사용은 충돌한다", async () => {
  const before=await snapshot();
  await db.query("select public.update_admin_student_profile_v2($1,$2,'가상 학생','가상고등학교','고2',$3)",[id,before.updatedAt,bundle.schoolKey]);
  const after=await snapshot(); expect(after.schoolKey).toBe(bundle.schoolKey); expect(after.updatedAt).not.toBe(before.updatedAt);
  await expect(db.query("select public.update_admin_student_profile_v2($1,$2,'가상 학생','가상고등학교','고2',null)",[id,before.updatedAt])).rejects.toThrow("student_profile_conflict");
  const detail=(await db.query<{value:{student:{schoolKey:string;updatedAt:string}}}>("select public.get_admin_student_detail_initial_v2($1) value",[id])).rows[0].value;
  expect(detail.student.schoolKey).toBe(bundle.schoolKey); expect(detail.student.updatedAt).toBe(after.updatedAt);
});
it("구 v1은 학교명이 같으면 키를 유지하고 달라지면 제거한다", async () => {
  await db.query("select public.update_admin_student_profile_v1($1,$2,'가상 수정','가상고등학교','옛 자유학년')",[id,(await snapshot()).updatedAt]);
  expect((await snapshot()).schoolKey).toBe(bundle.schoolKey);
  await db.query("select public.update_admin_student_profile_v1($1,$2,'가상 수정','다른 학교','옛 자유학년')",[id,(await snapshot()).updatedAt]);
  expect((await snapshot()).schoolKey).toBeNull();
});
it("명시적 연결 해제와 감사 실패 전체 롤백을 보존한다", async () => {
  const update=async(key:string|null)=>db.query("select public.update_admin_student_profile_v2($1,$2,'가상 학생','가상고등학교','고2',$3)",[id,(await snapshot()).updatedAt,key]);
  await update(bundle.schoolKey); await update(null); expect((await snapshot()).schoolKey).toBeNull();
  await db.exec("alter table audit_events add constraint deny_updates check(event_type<>'student.profile_updated') not valid");
  const before=await snapshot(); await expect(update(bundle.schoolKey)).rejects.toThrow(); expect(await snapshot()).toEqual(before);
  await db.exec("alter table audit_events drop constraint deny_updates"); await update(bundle.schoolKey);
});
it("신규 생성은 단어장 없이도 원자적으로 키·코드를 저장하고 실패면 모두 롤백한다", async () => {
  const create=(code:string)=>db.query("select * from public.create_student_with_code_v3('가상 신규','가상고등학교','고1',null,'','hash',$1,'iv','tag',$2)",[code,bundle.schoolKey]);
  const created=await create("fake-only"); expect(created.rows).toHaveLength(1);
  const count=async()=> (await db.query("select (select count(*) from students) students,(select count(*) from student_codes) codes")).rows;
  const before=await count(); await expect(create("fail")).rejects.toThrow("code_failed"); expect(await count()).toEqual(before);
  const row=(await db.query<{school_key:string}>("select school_key from students where id=$1",[(created.rows[0] as {student_id:string}).student_id])).rows[0]; expect(row.school_key).toBe(bundle.schoolKey);
});
it("개인 학교 연결은 관리자만, 학생 조회·자료 등록은 서버 역할만 허용한다", async () => {
  for(const role of ["anon","authenticated","service_role"]) {
    await db.exec(`set role ${role}`);
    try {
      await expect(db.query("select * from private.school_schedule_versions")).rejects.toThrow();
      if(role!=="authenticated") await expect(db.query("select public.get_admin_school_schedules_v1(null)")).rejects.toThrow();
      if(role!=="service_role") {
        await expect(db.query("select public.get_student_school_schedule_v1($1)",[id])).rejects.toThrow();
        await expect(register(bundle)).rejects.toThrow();
      } else expect((await db.query<{v:{students:unknown[]}}>("select public.get_student_school_schedule_v1($1) v",[id])).rows[0].v.students).toHaveLength(1);
    } finally { await db.exec("reset role"); }
  }
  await db.exec("set test.admin='no'; set role authenticated");
  try { await expect(db.query("select public.get_admin_school_schedules_v1(null)")).rejects.toThrow("forbidden"); }
  finally { await db.exec("reset role; set test.admin='yes'"); }
});
it("새 버전 등록 시 이전본을 보존한다", async () => {
  const handout={...bundle,versionId:"fake-v2",sourceHash:"c".repeat(64),events:bundle.events.map(event=>({...event,sourceUrl:null,sourceLabel:"학교 배부 안내문"}))};
  await register(handout);
  expect((await db.query<{payload:unknown}>("select payload from private.school_schedule_versions where version_id='fake-v2'")).rows[0].payload).toEqual(handout);
  expect((await db.query("select version_id,is_current from private.school_schedule_versions order by created_at")).rows).toEqual([
    {version_id:bundle.versionId,is_current:false},{version_id:"fake-v2",is_current:true},
  ]);
});
