import fs from 'node:fs';
import type { PGlite } from '@electric-sql/pglite';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createFinalSchemaDatabase } from '@/test-support/final-schema-database';

const migration='20261007154921_deduplicate_notebook_read_work.sql';
const id=(n:number)=>`94000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const admin=id(1),student=id(2),other=id(3),dataset=id(4),unit=id(5);
const signature='private.wrong_word_notebook_page_v3(uuid,uuid,text,text,bigint,timestamptz,text,integer,integer,text,integer,text,integer,text[])';
type Page={items:Array<{key:string;wrongCount:number;lastWrongAt:string;scheduling:string}>;totalCount:number;eventUpperId:string};
describe.sequential('단어장 활성 배정과 대기 항목의 반복 계산 회귀',()=>{
 let db:PGlite,beforeDefinition:string,afterDefinition:string;
 let beforeRights:unknown;
 beforeAll(async()=>{
  db=await createFinalSchemaDatabase({beforeMigration:async(database,name)=>{
   if(name!==migration)return;
   const row=(await database.query<{body:string;rights:unknown}>("select pg_get_functiondef($1::regprocedure) body,jsonb_build_array(proowner,proacl,prosecdef,provolatile,proisstrict,proconfig) rights from pg_proc where oid=$1::regprocedure",[signature])).rows[0];
   beforeDefinition=row.body;beforeRights=row.rights;
  }});
  afterDefinition=(await db.query<{body:string}>('select pg_get_functiondef($1::regprocedure) body',[signature])).rows[0].body;
  await db.exec(beforeDefinition.replace('private.wrong_word_notebook_page_v3(','private.expected_notebook_before_cost_fix('));
  await db.exec(`begin;
   select set_config('request.jwt.claim.sub','${admin}',true);select set_config('request.jwt.claim.role','authenticated',true);
   insert into auth.users(id) values('${admin}');insert into admin_profiles(user_id,display_name,is_active) values('${admin}','가짜관리자',true);
   insert into students(id,display_name,status,created_by) values('${student}','가짜성능학생','active','${admin}'),('${other}','다른가짜학생','active','${admin}');
   insert into vocab_datasets(id,dataset_key,title,source_label,source_sha256,row_count,status,imported_by) values('${dataset}','notebook-cost-fake','가짜 성능 책','가짜',repeat('A',64),12,'ready','${admin}');
   insert into vocab_units(id,dataset_id,unit_label,normalized_label,unit_kind,unit_number,sort_index,entry_count) values('${unit}','${dataset}','DAY 1','day 1','day',1,1,12);
   insert into vocab_entries(dataset_id,source_row,headword,headword_normalized,meanings,primary_meaning,row_sha256,unit_id,position_in_unit,entry_type)
    select '${dataset}',n,'word'||n,'word'||n,array['뜻'||n],'뜻'||n,upper(repeat(md5(n::text),2)),'${unit}',n,'word' from generate_series(1,12)n;
   insert into vocab_entry_quiz_eligibility(vocab_entry_id,dataset_id,quiz_mode,status,input_content_hash,rule_version,evaluated_at_utc)
    select id,dataset_id,'book_meaning_en_to_ko','eligible',repeat('B',64),'fixture',clock_timestamp() from vocab_entries where dataset_id='${dataset}';
  `);
  for(let k=1;k<=10;k++){
   const assignment=id(100+k),attempt=id(200+k),offset=(k%2===1?0:6);
   await db.exec(`
    insert into assignments(id,title,dataset_id,range_start,range_end,question_count,time_limit_seconds,timing_mode,passing_score,status,created_by) values('${assignment}','가짜 활성 배정 ${k}','${dataset}',${offset+1},${offset+6},6,240,'none',80,'active','${admin}');
    insert into assignment_units(assignment_id,dataset_id,unit_id,position,is_primary) values('${assignment}','${dataset}','${unit}',1,true);
    insert into assignment_students(assignment_id,student_id,assigned_by,assigned_at) values('${assignment}','${student}','${admin}','2026-09-29T00:00:00Z'::timestamptz+interval '${k} seconds');
    insert into assignment_questions(assignment_id,vocab_entry_id,base_order_index,direction,prompt,choices,correct_choice_index,dataset_id,headword_normalized_snapshot,headword_snapshot,primary_meaning_snapshot)
     select '${assignment}',id,source_row-${offset},'english_to_korean',headword,jsonb_build_array(primary_meaning,'가짜보기A','가짜보기B','가짜보기C'),0,dataset_id,headword_normalized,headword,primary_meaning from vocab_entries where dataset_id='${dataset}' and source_row between ${offset+1} and ${offset+6};
   `);
   if(k<=2)await db.exec(`
    insert into quiz_attempts(id,student_id,assignment_id,attempt_number,started_at,deadline_at,current_question_started_at,question_count_snapshot,time_limit_seconds_snapshot,passing_score_snapshot,passing_basis_snapshot) values('${attempt}','${student}','${assignment}',1,clock_timestamp()-interval '1 day',clock_timestamp()+interval '1 day',clock_timestamp(),6,240,80,'initial');
    insert into quiz_questions(attempt_id,vocab_entry_id,assignment_question_id,order_index,direction,prompt,choices,correct_choice_index)
     select '${attempt}',vocab_entry_id,id,base_order_index,direction,prompt,choices,correct_choice_index from assignment_questions where assignment_id='${assignment}';
    insert into student_vocab_wrong_events(student_id,dataset_id,vocab_entry_id,quiz_attempt_id,quiz_question_id,wrong_stage,wrong_at)
     select '${student}','${dataset}',vocab_entry_id,attempt_id,id,'initial','2026-09-29T01:00:00Z' from quiz_questions where attempt_id='${attempt}';
   `);
  }
  await db.exec(`insert into student_vocab_state(student_id,vocab_entry_id,unresolved_wrong_count,last_wrong_at,last_attempt_id,last_evaluated_at)
   select student_id,vocab_entry_id,1,wrong_at,quiz_attempt_id,wrong_at from student_vocab_wrong_events
   on conflict(student_id,vocab_entry_id) do update set unresolved_wrong_count=1,resolved_at=null;
   insert into student_vocab_review_queue(student_id,dataset_id,vocab_entry_id,source_attempt_id,source_question_id,reason_level,queued_by)
   select '${student}','${dataset}',vocab_entry_id,attempt_id,id,1,'${admin}' from quiz_questions order by vocab_entry_id limit 2;commit;`);
 },120000);
 afterAll(async()=>{await db?.close();});
 async function page(name='public.get_student_wrong_word_notebook_page_v2',args:unknown[]=[student]){
  return(await db.query<{value:Page}>(`select ${name}(${args.map((_,i)=>'$'+(i+1)).join(',')}) value`,args)).rows[0].value;
 }
 it('오답12개·활성문항60개·대기2개에서 기존 전체 응답과 같다',async()=>{
  const counts=(await db.query<{events:number;active:number;pending:number}>("select (select count(*)::int from student_vocab_wrong_events) events,(select count(*)::int from assignment_questions) active,(select count(*)::int from student_vocab_review_queue_read_v1 where status='pending') pending")).rows[0];
  expect(counts).toEqual({events:12,active:60,pending:2});
  const previous=await page('private.expected_notebook_before_cost_fix');
  const current=await page();expect(current).toEqual(previous);expect(current.totalCount).toBe(12);
  expect(current.items.every(w=>w.scheduling==='assigned')).toBe(true);
 },120000);
 it('비교식은 출처별 한 번만 계산하고 권한·정렬·본인 경계를 유지한다',async()=>{
  const expression='private.wrong_history_identity_v1(f.dataset_id,f.vocab_entry_id,g.dictionary_id,g.canonical_id,f.headword,true)';
  expect(afterDefinition.split(expression)).toHaveLength(2);
  expect(afterDefinition).toContain('latest_meanings as materialized');
  expect(afterDefinition).toContain('selection_datasets as materialized');
  expect(afterDefinition).toContain('resource_value as materialized');
  expect(afterDefinition).toContain('p.review_key =\n        f.review_key');
  expect(afterDefinition).toContain('a.review_key =\n        f.review_key');
  const rights=(await db.query<{rights:unknown}>("select jsonb_build_array(proowner,proacl,prosecdef,provolatile,proisstrict,proconfig) rights from pg_proc where oid=$1::regprocedure",[signature])).rows[0].rights;expect(rights).toEqual(beforeRights);
  const first=await page();const last=first.items[9];const second=await page(undefined,[student,null,'all','',first.eventUpperId,last.lastWrongAt,last.key,null,null,'count',last.wrongCount]);
  expect(second.items.some(w=>first.items.slice(0,10).some(v=>v.key===w.key))).toBe(false);
  expect((await page(undefined,[other])).items).toEqual([]);
  expect((await page(undefined,[student,null,'all','',null,null,null,null,null,'recent'])).totalCount).toBe(12);
 },600);
 it('예상과 다른 정의에는 적용을 거절한다',async()=>{
  await expect(db.exec(fs.readFileSync('supabase/migrations/'+migration,'utf8'))).rejects.toThrow('notebook_read_base_drift');
  await db.exec('rollback');
 });
 it('활성 배정이 없는 대기 단어와 미배정 단어도 기존 상태 그대로 남는다',async()=>{
  await db.exec('begin');
  try{
   await db.query("update assignments set status='closed' where id=any($1::uuid[])",[[1,3,5,7,9].map(k=>id(100+k))]);
   const current=await page();
   expect(current).toEqual(await page('private.expected_notebook_before_cost_fix'));
   expect(current.items.find(w=>w.key==='headword:'+dataset+':word1')?.scheduling).toBe('queued');
   expect(current.items.some(w=>w.scheduling==='available')).toBe(true);
  }finally{await db.exec('rollback');}
 },120000);
});
