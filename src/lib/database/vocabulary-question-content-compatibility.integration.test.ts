import type { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, expect, it } from "vitest";
import { createFinalSchemaDatabase } from "@/test-support/final-schema-database";
import { buildPracticePlan, practiceSourceSchema } from "@/features/quiz-player/domain/practice-plan";
import type { QuizAttemptResponse } from "@/features/quiz-player/model";

const id = (n: number) => `a2050000-0000-4000-8000-${String(n).padStart(12, "0")}`;
let db: PGlite, oldRows: unknown, oldPlan: unknown, oldFingerprint: unknown, prep: string, attempt: string;
let answered: { id: string; correct_choice_index: number }, answerReceipt: unknown;
let practicePrep:string,practiceRun:QuizAttemptResponse,practicePlan:unknown,practiceAnswerReceipt:unknown,practiceChoice:number;
const migration = "20261001145444_share_vocabulary_question_content.sql";
async function value<T>(sql: string, args: unknown[] = []) { return (await db.query<{ value: T }>(sql, args)).rows[0].value; }
const records = (hasReference: boolean) => `select jsonb_build_object(
  'banks',(select jsonb_agg(to_jsonb(q)${hasReference ? "-'content_version_id'" : ""} order by id) from public.assignment_questions q),
  'questions',(select jsonb_agg(to_jsonb(q)${hasReference ? "-'content_version_id'" : ""} order by id) from public.quiz_questions q),
  'attempts',(select jsonb_agg(to_jsonb(a) order by id) from public.quiz_attempts a),
  'preparations',(select jsonb_agg(to_jsonb(p) order by id) from private.quiz_attempt_preparations p),
  'practiceRuns',(select jsonb_agg(to_jsonb(r) order by id) from private.student_word_practice_runs r),
  'practiceQuestions',(select jsonb_agg(to_jsonb(q)${hasReference ? "-'content_version_id'" : ""} order by id) from private.student_word_practice_questions q)) value`;
beforeAll(async () => {
  db = await createFinalSchemaDatabase({ beforeMigration: async (database, name) => {
    if (name !== migration) return;
    db = database;
    // These rows are created in the actual pre-M02 schema, not by leaving a new
    // column NULL after the change. No production record or original is used.
    await db.exec(`insert into auth.users(id) values('${id(1)}');
      insert into public.admin_profiles(user_id,display_name) values('${id(1)}','Fake old admin');
      insert into public.students(id,display_name,created_by,school_name,grade_label) values('${id(2)}','Fake old student','${id(1)}','Fake school','고2');
      insert into public.vocab_datasets(id,dataset_key,title,source_label,source_sha256,row_count,status,imported_by)
        values('${id(3)}','m02-old-format','Fake old dictionary','Fake',repeat('A',64),4,'ready','${id(1)}');
      insert into public.vocab_units(id,dataset_id,unit_label,normalized_label,unit_kind,unit_number,sort_index,entry_count)
        values('${id(4)}','${id(3)}','DAY 1','day1','day',1,1,4);
      insert into public.vocab_entries(dataset_id,source_row,headword,headword_normalized,meanings,primary_meaning,row_sha256,unit_id,position_in_unit,entry_type)
        select '${id(3)}',n,'oldword'||n,'oldword'||n,array['당시 뜻'||n],'당시 뜻'||n,repeat('B',63)||n::text,'${id(4)}',n,'word' from generate_series(1,4)n;
      insert into public.assignments(id,title,dataset_id,range_start,range_end,question_count,english_to_korean_ratio,time_limit_seconds,
        timing_mode,passing_score,status,created_by,retake_allowed,range_basis,question_bank_version,question_order_mode)
        select a,'Fake old exam','${id(3)}',1,4,4,100,240,'none',80,'active','${id(1)}',true,'units',1,'fixed'
        from unnest(array['${id(10)}','${id(11)}','${id(12)}']::uuid[])a;
      insert into public.assignment_units(assignment_id,dataset_id,unit_id,position,is_primary)
        select id,'${id(3)}','${id(4)}',1,true from public.assignments;
      insert into public.assignment_students(assignment_id,student_id,assigned_by) select id,'${id(2)}','${id(1)}' from public.assignments;
      insert into public.assignment_questions(assignment_id,dataset_id,vocab_entry_id,base_order_index,direction,prompt,choices,correct_choice_index,
        headword_snapshot,primary_meaning_snapshot,choice_vocab_entry_ids)
        select a.id,'${id(3)}',e.id,e.source_row,'english_to_korean',e.headword,
          (select jsonb_agg(primary_meaning order by source_row) from public.vocab_entries),(e.source_row-1)::smallint,
          e.headword,e.primary_meaning,(select array_agg(id order by source_row) from public.vocab_entries)
        from public.assignments a cross join public.vocab_entries e;
      select set_config('request.jwt.claim.role','service_role',false);`);
    prep = await value<string>("select public.prepare_quiz_attempt_v1($1,$2,null) value", [id(2), id(10)]);
    oldPlan = await value("select public.get_quiz_preparation_v1($1,$2) value", [id(2), prep]);
    attempt = await value<string>("select public.create_quiz_attempt_from_bank($1,$2) value", [id(2), id(11)]);
    answered = (await db.query<{ id: string; correct_choice_index: number }>("select id,correct_choice_index from public.quiz_questions where attempt_id=$1 order by order_index limit 1", [attempt])).rows[0];
    answerReceipt = await value("select public.answer_quiz_question_v4($1,$2,$3,'initial',$4::smallint,false) value", [id(2), attempt, answered.id, answered.correct_choice_index]);
    const wrongAttempt=await value<string>("select public.create_quiz_attempt_from_bank($1,$2) value",[id(2),id(12)]);
    const wrongQuestions=(await db.query<{id:string;correct_choice_index:number}>('select id,correct_choice_index from public.quiz_questions where attempt_id=$1 order by order_index',[wrongAttempt])).rows;
    for(const [index,q] of wrongQuestions.entries()){
      if(index)await db.query("select public.resume_quiz_after_feedback_v2($1,$2,$3,'initial',0)",[id(2),wrongAttempt,q.id]);
      await db.query("select public.answer_quiz_question_v4($1,$2,$3,'initial',$4::smallint,false)",[id(2),wrongAttempt,q.id,(q.correct_choice_index+1)%4]);
    }
    await db.exec(`insert into public.vocab_entry_quiz_eligibility(vocab_entry_id,dataset_id,quiz_mode,status,input_content_hash,rule_version,evaluated_at_utc)
      select id,dataset_id,'book_meaning_en_to_ko','eligible',repeat('B',64),'fixture',clock_timestamp() from public.vocab_entries;`);
    const selection={mode:'filtered',filters:{}},config={questionCount:4,englishToKoreanRatio:100 as const,timingMode:'none' as const,timeLimitSeconds:null,questionTimeLimitSeconds:null};
    const source=practiceSourceSchema.parse(await value('select public.prepare_student_word_practice_v1($1,$2) value',[id(2),JSON.stringify(selection)]));
    const plan=buildPracticePlan(source,config,'legacy-practice'),byId=new Map(plan.candidates.map(e=>[e.id,e]));
    expect(plan.error).toBeNull();
    const voice={displayKo:null,variantId:null,audioUrl:null,available:false};
    const questions=plan.questions.map(q=>({...q,wordKey:byId.get(q.vocabEntryId)!.key,pronunciation:voice,choicePronunciations:[voice,voice,voice,voice],
      choiceSources:q.choiceVocabEntryIds.map(key=>{const e=byId.get(key)!;return {entryId:e.entryId,headword:e.headword,primaryMeaning:e.primaryMeaning};})}));
    const args=(key:string)=>[id(2),key,'a'.repeat(64),JSON.stringify(selection),JSON.stringify(config),source.sourceHash,JSON.stringify(questions)];
    practicePrep=await value('select public.prepare_word_practice_start_v1($1,$2,$3,$4,$5,$6,$7) value',args(id(50)));
    practicePlan=await value('select public.get_quiz_preparation_v1($1,$2) value',[id(2),practicePrep]);
    practiceRun=await value<QuizAttemptResponse>('select public.start_student_word_practice_v1($1,$2,$3,$4,$5,$6,$7) value',args(id(51)));
    practiceChoice=questions[0].correctChoiceIndex;
    practiceAnswerReceipt=await value('select public.answer_student_word_practice_v1($1,$2,$3,$4) value',[id(2),practiceRun.attempt.id,practiceRun.attempt.questions[0].id,practiceChoice]);
    practiceRun=await value<QuizAttemptResponse>('select public.get_student_word_practice_v1($1,$2) value',[id(2),practiceRun.attempt.id]);
    oldRows = await value(records(false));
    oldFingerprint = await value("select private.quiz_preparation_fingerprint(a) value from public.assignments a where id=$1", [id(10)]);
  } });
}, 120_000);
afterAll(async () => { await db?.close(); });
it("preserves every old bank, prepared plan, attempt, answer and original preparation fingerprint through the migration", async () => {
  expect(await value(records(true))).toEqual(oldRows);
  expect(await value("select private.quiz_preparation_fingerprint(a) value from public.assignments a where id=$1", [id(10)])).toEqual(oldFingerprint);
  expect(await value("select public.get_quiz_preparation_v1($1,$2) value", [id(2), prep])).toEqual(oldPlan);
  expect(await value('select public.get_quiz_preparation_v1($1,$2) value',[id(2),practicePrep])).toEqual(practicePlan);
  expect(await value("select count(*)::int value from private.vocabulary_question_content_versions")).toBe(0);
  const read = await value<{items: Array<{id: string; prompt: string}>}>("select public.read_question_contents_v1('student_attempt',$1,$2,$3) value", [id(2), attempt, [answered.id]]);
  expect(read.items).toMatchObject([{ id: answered.id, prompt: "oldword1" }]);
  expect(answerReceipt).toMatchObject({ correct: true });
});
it('preserves the old practice answer and starts its old prepared plan without rewriting the receipt',async()=>{
  const read=await value<QuizAttemptResponse>('select public.get_student_word_practice_v1($1,$2) value',[id(2),practiceRun.attempt.id]);
  expect(read.attempt.questions).toEqual(practiceRun.attempt.questions);
  expect(read.attempt.startedAt).toBe(practiceRun.attempt.startedAt);
  expect(await value('select public.answer_student_word_practice_v1($1,$2,$3,$4) value',[id(2),practiceRun.attempt.id,practiceRun.attempt.questions[0].id,practiceChoice])).toEqual(practiceAnswerReceipt);
  const before=await value('select plan value from private.quiz_attempt_preparations where id=$1',[practicePrep]);
  const run=await value<QuizAttemptResponse>('select public.begin_prepared_practice_v1($1,$2) value',[id(2),practicePrep]);
  expect(await value('select plan value from private.quiz_attempt_preparations where id=$1',[practicePrep])).toEqual(before);
  expect(await value("select count(*)::int value from private.student_word_practice_questions where run_id=$1 and content_version_id is not null and not(body ? 'prompt' or body ? 'choices')",[run.attempt.id])).toBe(4);
  expect(run.attempt.questions.map(q=>({prompt:q.prompt,choices:q.choices}))).toEqual(practiceRun.attempt.questions.map(q=>({prompt:q.prompt,choices:q.choices})));
});
it("begins the existing prepared plan with the same question IDs and order, leaving its original inline plan intact", async () => {
  const started = await value<string>("select public.begin_prepared_quiz_v1($1,$2) value", [id(2), prep]);
  expect(await value("select public.begin_prepared_quiz_v1($1,$2) value", [id(2), prep])).toBe(started);
  const original = oldPlan as { plan: Array<{id: string; prompt: string; choices: string[]}> };
  const restored = (await db.query("select id,prompt,choices from private.quiz_question_contents_v1 where attempt_id=$1 order by order_index", [started])).rows;
  expect(restored).toEqual(original.plan.map(({ id, prompt, choices }) => ({ id, prompt, choices })));
  expect(await value("select jsonb_typeof(plan) value from private.quiz_attempt_preparations where id=$1", [prep])).toBe("array");
  expect(await value("select count(*)::int value from public.quiz_questions where attempt_id=$1 and content_version_id is not null and prompt is null and choices is null", [started])).toBe(4);
  expect(await value("select count(*)::int value from public.assignment_questions where content_version_id is not null")).toBe(0);
});
