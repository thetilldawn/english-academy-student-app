import fs from "node:fs";
import type { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createFinalSchemaDatabase } from "@/test-support/final-schema-database";

const migration = "20261004050000_stop_duplicate_local_quiz_state.sql";
const id = (n: number) => 'a1040000-0000-4000-8000-' + String(n).padStart(12, "0");
const targets = ["public.submit_local_quiz_phase_v1(uuid,uuid,text,text,text,uuid,jsonb,jsonb)",
  "public.get_admin_student_wrong_word_page_v1(uuid,uuid,text,text,bigint,timestamp with time zone,text)",
  "private.wrong_word_notebook_page_v1(uuid,uuid,text,text,bigint,timestamp with time zone,text,integer,integer)",
  "private.wrong_word_notebook_page_v3(uuid,uuid,text,text,bigint,timestamp with time zone,text,integer,integer,text,integer,text,integer,text[])"];

describe.sequential("새 시험 상태의 단일 기록과 기존 행 보존", () => {
  let db: PGlite;
  let beforeRows: unknown;
  let beforeMeta: unknown;
  let oldWriter: string;
  async function rows() {
    return (await db.query("select jsonb_build_object('students',(select jsonb_agg(to_jsonb(t)) from public.students t),"+
      "'entries',(select jsonb_agg(to_jsonb(t)) from public.vocab_entries t),"+
      "'states',(select jsonb_agg(to_jsonb(t)) from public.student_vocab_state t),"+
      "'baselines',(select jsonb_agg(to_jsonb(t)) from private.vocabulary_legacy_state_baselines t)) value")).rows;
  }
  async function metadata() {
    return (await db.query("select oid,proowner,proacl,prosecdef,provolatile,proconfig from pg_proc where oid=any($1::regprocedure[]) order by oid",[targets])).rows;
  }
  beforeAll(async () => {
    db = await createFinalSchemaDatabase({beforeMigration: async (database,name) => {
      if(name!==migration)return;
      db=database;
      await db.exec("begin;insert into auth.users(id)values('"+id(1)+"');"+
        "insert into public.admin_profiles(user_id,display_name)values('"+id(1)+"','보존 검사 관리자');"+
        "insert into public.students(id,display_name,status,created_by)values('"+id(2)+"','보존 검사 학생','active','"+id(1)+"');"+
        "insert into public.vocab_datasets(id,dataset_key,title,source_label,source_sha256,row_count,status,imported_by)"+
        "values('"+id(4)+"','state-storage-fake','보존 검사 자료','fake',repeat('A',64),1,'ready','"+id(1)+"');"+
        "insert into public.vocab_units(id,dataset_id,unit_label,normalized_label,unit_kind,unit_number,sort_index,entry_count)"+
        "values('"+id(5)+"','"+id(4)+"','DAY 1','day1','day',1,1,1);"+
        "insert into public.vocab_entries(dataset_id,source_row,headword,headword_normalized,meanings,primary_meaning,row_sha256,unit_id,position_in_unit,entry_type)"+
        "values('"+id(4)+"',1,'fakestate','fakestate',array['가짜 뜻'],'가짜 뜻',repeat('B',64),'"+id(5)+"',1,'word');"+
        "insert into public.assignments(id,title,dataset_id,range_start,range_end,question_count,english_to_korean_ratio,time_limit_seconds,timing_mode,passing_score,status,created_by)"+
        "values('"+id(10)+"','보존 검사 시험','"+id(4)+"',1,1,1,100,240,'none',80,'active','"+id(1)+"');"+
        "insert into public.assignment_units(assignment_id,dataset_id,unit_id,position,is_primary)values('"+id(10)+"','"+id(4)+"','"+id(5)+"',1,true);"+
        "insert into public.assignment_students(assignment_id,student_id,assigned_by)values('"+id(10)+"','"+id(2)+"','"+id(1)+"');commit;");
      await db.exec("select set_config('request.jwt.claim.role','service_role',false)");
      const questions=(await db.query<{value:unknown}>("select jsonb_agg(jsonb_build_object('vocab_entry_id',id,'order_index',1,'direction','english_to_korean',"+
        "'prompt',headword,'choices',jsonb_build_array(primary_meaning,'가짜 보기2','가짜 보기3','가짜 보기4'),'correct_choice_index',0)) value from public.vocab_entries")).rows[0].value;
      const prep=(await db.query<{value:string}>("select public.prepare_quiz_attempt_v1($1,$2,$3::jsonb) value",[id(2),id(10),JSON.stringify(questions)])).rows[0].value;
      await db.query("select public.begin_prepared_quiz_v1($1,$2)",[id(2),prep]);
      const question=(await db.query<{id:string}>("select id from public.quiz_questions where attempt_id=$1",[prep])).rows[0].id;
      await db.query("select public.answer_quiz_question_v4($1,$2,$3,'initial',1::smallint,false)",[id(2),prep,question]);
      expect((await db.query("select * from public.student_vocab_state")).rows).toHaveLength(1);
      beforeRows=await rows();beforeMeta=await metadata();
      oldWriter=(await db.query<{definition:string}>("select pg_get_functiondef($1::regprocedure) definition",[targets[0]])).rows[0].definition;
    }});
  },120_000);
  afterAll(async()=>{await db?.close();});
  it("기존 학생·단어·상태·기초값과 함수 권한을 변경하지 않는다",async()=>{
    expect(await rows()).toEqual(beforeRows);
    expect(await metadata()).toEqual(beforeMeta);
  });
  it("재적용은 같은 결과이며 다른 원형은 부분 적용 없이 거절한다",async()=>{
    const sql=fs.readFileSync("supabase/migrations/"+migration,"utf8");
    await db.exec(sql);
    expect(await rows()).toEqual(beforeRows);expect(await metadata()).toEqual(beforeMeta);
    await db.exec(oldWriter.replace("  perform private.project_local_quiz_legacy_state_v1(p_student_id,a.id);",
      "  perform private.project_local_quiz_legacy_state_v1(p_student_id,a.id); -- unexpected source"));
    await expect(db.exec(sql)).rejects.toThrow("shared_state_source_changed");
    await db.exec("rollback");
    await db.exec(oldWriter);
    await db.exec(sql);
    expect(await rows()).toEqual(beforeRows);
  });
});

