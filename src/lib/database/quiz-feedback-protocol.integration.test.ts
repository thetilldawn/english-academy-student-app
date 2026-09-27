import type { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createFinalSchemaDatabase } from "@/test-support/final-schema-database";
import { answerQuizQuestionWithCompatibleRpc } from "@/lib/services/quiz-rpc-compatibility";

const id = (n: number) => `90000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const seed = (mode: string, limit: number | null) => `
begin;
select set_config('request.jwt.claim.sub','${id(1)}',true);
select set_config('request.jwt.claim.role','authenticated',true);
select set_config('request.jwt.claims','{"role":"authenticated"}',true);
insert into auth.users(id) values('${id(1)}');
insert into admin_profiles(user_id,display_name,is_active) values('${id(1)}','Fake admin',true);
insert into students(id,display_name,status,created_by) values('${id(2)}','Fake timer student','active','${id(1)}');
insert into vocab_datasets(id,dataset_key,title,source_label,source_sha256,row_count,status,imported_by)
values('${id(4)}','timer-regression-fake','Fake timer set','Fake',repeat('A',64),4,'ready','${id(1)}');
insert into vocab_units(id,dataset_id,unit_label,normalized_label,unit_kind,unit_number,sort_index,entry_count)
values('${id(100)}','${id(4)}','DAY 1','day 1','day',1,1,4);
insert into assignments(id,title,dataset_id,range_start,range_end,question_count,time_limit_seconds,timing_mode,
question_time_limit_seconds,passing_score,status,created_by,retake_allowed)
values('${id(10)}','Fake timer exam','${id(4)}',1,4,4,240,'${mode}',${limit ?? "null"},80,'active','${id(1)}',true);
insert into assignment_units(assignment_id,dataset_id,unit_id,position,is_primary) values('${id(10)}','${id(4)}','${id(100)}',1,true);
insert into assignment_students(assignment_id,student_id,assigned_by,assigned_at)
values('${id(10)}','${id(2)}','${id(1)}',clock_timestamp()-interval '1 day');
insert into quiz_attempts(id,student_id,assignment_id,attempt_number,started_at,deadline_at,current_question_started_at,
question_count_snapshot,time_limit_seconds_snapshot,passing_score_snapshot,passing_basis_snapshot)
values('${id(60)}','${id(2)}','${id(10)}',1,clock_timestamp()-interval '1 second',
clock_timestamp()+interval '233 seconds',clock_timestamp()-interval '1 second',4,240,80,'initial');
insert into vocab_entries(dataset_id,source_row,headword,headword_normalized,meanings,primary_meaning,row_sha256,unit_id,position_in_unit,entry_type)
select '${id(4)}',n,'fake'||n,'fake'||n,array['Fake meaning'||n],'Fake meaning'||n,repeat('B',63)||n::text,'${id(100)}',n,'word' from generate_series(1,4)n;
insert into quiz_questions(id,attempt_id,vocab_entry_id,order_index,direction,prompt,choices,correct_choice_index)
select ('90000000-0000-4000-8000-'||lpad((200+source_row)::text,12,'0'))::uuid,'${id(60)}',id,source_row,'english_to_korean',headword,'["a","b","c","d"]',0
from vocab_entries where dataset_id='${id(4)}';
`;
describe.sequential("total feedback protocol against the final database", () => {
  let db: PGlite;
  let beforeSecurity: unknown;
  const security = `select proacl,prosecdef,proconfig,provolatile from pg_proc where oid='public.answer_quiz_question_v2(uuid,uuid,uuid,text,smallint,boolean)'::regprocedure`;
  beforeAll(async () => {
    db = await createFinalSchemaDatabase({ beforeMigration: async (database, name) => {
      if(name === "20260927080438_declare_quiz_feedback_protocol.sql") beforeSecurity = (await database.query(security)).rows;
    }});
  }, 60_000);
  afterAll(async () => { await db?.close(); });
  it("preserves the existing function privileges and security attributes", async () => {
    expect((await db.query(security)).rows).toEqual(beforeSecurity);
  });
  it.each([["total", null], ["per_question", 5], ["per_question", 8], ["per_question", 10]] as const)(
    "declares the real v2 contract and preserves %s/%s over three questions", async (mode, limit) => {
      await db.exec(seed(mode,limit));
      try {
        let priorBudget = 233_000;
        for(let n=1;n<=3;n++){
          const result = await answerQuizQuestionWithCompatibleRpc(async name => {
            if(name !== "answer_quiz_question_v2") return { data:null,error:{code:"PGRST202",message:name+" missing"} };
            const answer = await db.query<{value: unknown}>("select public.answer_quiz_question_v2($1,$2,$3,'initial',0::smallint,false) value",[id(2),id(60),id(200+n)]);
            return {data:answer.rows[0]!.value,error:null};
          }, {});
          expect(result.feedbackProtocol).toBe("variable");
          // The reserved start, not raw deadline-now, defines the next usable budget.
          const pending = (await db.query<{budget: number}>(`select extract(epoch from (deadline_at-current_question_started_at))*1000 budget from quiz_attempts where id='${id(60)}'`)).rows[0]!.budget;
          await db.query("select public.resume_quiz_after_feedback_v2($1,$2,$3,'initial',0)",[id(2),id(60),id(201+n)]);
          const resumed = (await db.query<{budget: number; per: number}>(`select extract(epoch from(deadline_at-current_question_started_at))*1000 budget,
            extract(epoch from(current_question_started_at-clock_timestamp()))*1000 per from quiz_attempts where id='${id(60)}'`)).rows[0]!;
          if(mode==="total"){
            expect(Number(resumed.budget)).toBeCloseTo(Number(pending),1);
            expect(Number(resumed.budget)).toBeLessThanOrEqual(priorBudget);
            priorBudget=Number(resumed.budget);
          } else expect(Number(resumed.per)).toBeLessThanOrEqual(0);
        }
      } finally { await db.exec("rollback"); }
    });
});

