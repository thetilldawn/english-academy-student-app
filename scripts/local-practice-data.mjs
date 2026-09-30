// Opt-in local browser fixture. SQL runs only in a fresh in-memory PGlite DB.
// No remote connection, real credentials, or application authentication bypass.
import { createFinalSchemaDatabase } from '../src/test-support/final-schema-database.ts';
import { notebookFixtureWords } from './local-notebook-data.mjs';
import { STUDY_SECRET } from './local-student-study-data.mjs';
const uid = n => '00000000-0000-4000-8000-' + String(n).padStart(12, '0');
const student = uid(1), admin = uid(900), dataset = uid(3), assignment = uid(901), attempt = uid(902), unit = uid(903);
const names = new Set(['prepare_student_word_practice_v1', 'get_student_word_practice_v1', 'start_student_word_practice_v1', 'answer_student_word_practice_v1', 'resume_student_word_practice_v1', 'expire_student_word_practice_v1']);
let database;
export async function prepareLocalPractice() {
  if (process.env.VERCEL || process.env.CI) throw Error('Local practice fixture only');
  const db = await createFinalSchemaDatabase();
  database = db;
  await db.exec(`begin;
    select set_config('request.jwt.claim.sub','${admin}',true);
    select set_config('request.jwt.claim.role','authenticated',true);
    select set_config('request.jwt.claims','{"role":"authenticated"}',true);
    insert into auth.users(id) values('${admin}');
    insert into admin_profiles(user_id,display_name,is_active) values('${admin}','가짜 관리자',true);
    insert into students(id,display_name,status,created_by) values('${student}','가짜 연습 학생','active','${admin}');
    insert into vocab_datasets(id,dataset_key,title,source_label,source_sha256,row_count,status,imported_by)
      values('${dataset}','local-practice-only','가짜 연습 단어장','가짜',repeat('A',64),25,'ready','${admin}');
    insert into vocab_units(id,dataset_id,unit_label,normalized_label,unit_kind,unit_number,sort_index,entry_count)
      values('${unit}','${dataset}','DAY 1','day 1','day',1,1,25);
    insert into assignments(id,title,dataset_id,range_start,range_end,question_count,time_limit_seconds,timing_mode,question_time_limit_seconds,passing_score,status,created_by,retake_allowed)
      values('${assignment}','가짜 원천 시험','${dataset}',1,25,25,240,'none',null,80,'active','${admin}',true);
    insert into assignment_units(assignment_id,dataset_id,unit_id,position,is_primary) values('${assignment}','${dataset}','${unit}',1,true);
    insert into assignment_students(assignment_id,student_id,assigned_by,assigned_at) values('${assignment}','${student}','${admin}',clock_timestamp()-interval '1 day');
    insert into quiz_attempts(id,student_id,assignment_id,attempt_number,started_at,deadline_at,current_question_started_at,question_count_snapshot,time_limit_seconds_snapshot,passing_score_snapshot,passing_basis_snapshot)
      values('${attempt}','${student}','${assignment}',1,clock_timestamp()-interval '1 day',clock_timestamp()+interval '1 day',clock_timestamp(),25,240,80,'initial');
  `);
  let ordinal = 0;
  notebookFixtureWords.forEach(word => { word.wrongCount = 1; });
  for (const [index, word] of notebookFixtureWords.entries()) {
    await db.query(`insert into vocab_entries(id,dataset_id,source_row,headword,headword_normalized,meanings,primary_meaning,row_sha256,unit_id,position_in_unit,entry_type)
      overriding system value values($1::bigint,$2,$1::integer,$3,$3,array[$4],$4,repeat('B',56)||lpad($1::text,8,'0'),$5,$1::integer,'word')`, [index + 1, dataset, word.headword, word.primaryMeaning, unit]);
    for (let n = 0; n < word.wrongCount; n++) {
      const question = uid(1000 + ++ordinal);
      await db.query(`insert into quiz_questions(id,attempt_id,vocab_entry_id,order_index,direction,prompt,choices,correct_choice_index)
        values($1,$2,$3,$4,'english_to_korean',$5,$6,0)`, [question, attempt, index + 1, ordinal, word.headword, JSON.stringify([word.primaryMeaning,'검사 보기 갑','검사 보기 을','검사 보기 병'])]);
      await db.query(`insert into student_vocab_wrong_events(student_id,dataset_id,vocab_entry_id,quiz_attempt_id,quiz_question_id,wrong_stage,wrong_at)
        values($1,$2,$3,$4,$5,'initial','2026-09-30T00:00:00.123456Z')`, [student,dataset,index+1,attempt,question]);
    }
  }
  await db.exec(`insert into vocab_entry_quiz_eligibility(vocab_entry_id,dataset_id,quiz_mode,status,input_content_hash,rule_version,evaluated_at_utc)
    select e.id,e.dataset_id,m.mode,'eligible',repeat('B',64),'fixture',clock_timestamp() from vocab_entries e cross join(values('book_meaning_en_to_ko'),('book_meaning_ko_to_en'))m(mode);
    commit;`);
  database = db;
}
export async function closeLocalPractice() { await database?.close(); database = null; }
// Only another opt-in local fixture may share this ephemeral SQL database.
export async function withLocalPracticeDatabase(operation) {
  if (!database || process.env.VERCEL || process.env.CI) throw Error('Local database is not ready');
  return operation(database);
}
const emptyReads = new Set(['list_entry_source_pronunciations_v1','list_entry_approved_korean_pronunciations_v1','list_active_vocab_pronunciation_bindings_v3','list_mock_composition_lineage_v1']);
export async function localPracticeFixture({ url, method, headers, body }) {
  const target = new URL(url), name = target.pathname.split('/').at(-1);
  if (target.origin !== 'http://127.0.0.1:3038' || headers.get('apikey') !== STUDY_SECRET || headers.get('authorization') !== 'Bearer '+STUDY_SECRET) return null;
  if (method === 'GET' && ['vocab_entry_pronunciations','vocab_approved_korean_pronunciations','vocab_rule_derived_korean_pronunciations'].includes(name)) return {status:200,body:[],category:'practice-empty-voice'};
  if (method === 'POST' && emptyReads.has(name)) return {status:200,body:[],category:'practice-empty-voice'};
  if (method !== 'POST' || !names.has(name)) return null;
  const input = JSON.parse(body || '{}');
  if (!database || input.p_student_id !== student || Object.keys(input).some(k => !/^p_[a-z_]+$/.test(k))) return {status:403,body:{message:'local practice student only'},category:'practice-rejected'};
  try {
    const result = await database.transaction(async tx => {
      await tx.exec("select set_config('request.jwt.claim.role','service_role',true);select set_config('request.jwt.claims','{\"role\":\"service_role\"}',true);set local role service_role;");
      const entries = Object.entries(input);
      return (await tx.query(`select public.${name}(${entries.map(([key], i) => `${key}=>$${i+1}`).join(',')}) value`, entries.map(([,value]) => value))).rows[0].value;
    });
    // Pronunciation is a deterministic approved-sample fixture. Questions,
    // ownership, receipts, timers and history still use the final SQL exactly.
    if (name === 'prepare_student_word_practice_v1') for (const word of result.words) {
      const sample = notebookFixtureWords.find(item => item.key === word.key);
      if (sample) word.studySource = sample.studySource;
    }
    return {status:200,body:result,category:'practice-sql'};
  } catch (error) { return {status:error.code==='42501'?403:400,body:{message:error.message,code:error.code},category:'practice-sql-error'}; }
}
export const isLocalPracticeRequest = (pathname, method) => ['GET','POST'].includes(method) && /^\/api\/student\/practice(?:\/preview|\/[a-f0-9-]{36}(?:\/(?:answers|timeouts|feedback|expire))?)?$/.test(pathname);
