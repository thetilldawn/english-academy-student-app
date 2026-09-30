import fs from "node:fs";
import path from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createFinalSchemaDatabase } from "@/test-support/final-schema-database";

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const student=id(1), other=id(2), dataset=id(3);
const sql=fs.readFileSync(path.resolve("supabase/migrations/20260929165150_expand_student_word_notebook.sql"),"utf8");
type Item={key:string;wrongCount:number;lastWrongAt:string;headword:string;primaryMeaning:string;studySource:Record<string,unknown>};
type Page={items:Item[];totalCount:number|null;eventUpperId:string;notebookSummary:Record<string,number>|null};
describe.sequential("내 단어장 학습 조회",()=>{
  let db:PGlite;
  beforeAll(async()=>{
    db=new PGlite();
    await db.exec(`
      create role anon; create role authenticated; create role service_role;
      create schema private; create schema word_index;
      create table students(id uuid primary key,deleted_at timestamptz,status text default 'active');
      create table vocab_datasets(id uuid primary key,title text,edition text);
      create table vocab_entries(id bigint primary key,dataset_id uuid,headword text,headword_normalized text,primary_meaning text,pronunciation_ko text);
      create table assignments(id uuid primary key,dataset_id uuid,status text,title text);
      create table assignment_students(assignment_id uuid,student_id uuid,assigned_at timestamptz,cancelled_at timestamptz,missed_at timestamptz);
      create table assignment_questions(id uuid primary key,assignment_id uuid,dataset_id uuid,vocab_entry_id bigint,canonical_lexeme_id_snapshot uuid,headword_normalized_snapshot text,headword_snapshot text,primary_meaning_snapshot text,provenance_status text,
        composition_pronunciation_snapshot jsonb,eligibility_quiz_mode text,prompt text,canonical_question_release_id_snapshot text,canonical_question_item_id_snapshot text,canonical_question_item_sha256_snapshot text,composition_version_id_snapshot uuid,reviewed_exam_release_id_snapshot text,entry_row_sha256_snapshot text);
      create table assignment_question_exam_use_snapshot(assignment_question_id uuid primary key,dictionary_id text,headword_snapshot text,primary_meaning_snapshot text,provenance_status text,release_id text,display_pronunciation_ko_snapshot text,pronunciation_snapshot jsonb);
      create table quiz_attempts(id uuid primary key,assignment_id uuid,student_id uuid,status text);
      create table quiz_questions(id uuid primary key,vocab_entry_id bigint,assignment_question_id uuid,initial_is_correct boolean,retry_is_correct boolean,direction text,prompt text,choices jsonb,correct_choice_index integer);
      create table student_vocab_wrong_events(id bigint primary key,student_id uuid,quiz_attempt_id uuid,quiz_question_id uuid,dataset_id uuid,vocab_entry_id bigint,canonical_dictionary_id_snapshot text,canonical_lexeme_id_snapshot uuid,wrong_stage text,wrong_at timestamptz);
      create table student_vocab_state(student_id uuid,vocab_entry_id bigint,unresolved_wrong_count integer,resolved_at timestamptz,last_evaluated_at timestamptz,primary key(student_id,vocab_entry_id));
      create table student_vocab_review_queue_read_v1(id uuid,student_id uuid,dataset_id uuid,vocab_entry_id bigint,canonical_dictionary_id_snapshot text,canonical_lexeme_id_snapshot uuid,source_question_id uuid,reason_level smallint,queued_at timestamptz,active_review_draft_id uuid,status text);
      create table word_index.app_canonical_question_preview_release(release_id text,exam_use_release_id text);
      create table word_index.app_canonical_question_preview_item(release_id text,vocab_entry_id bigint,quiz_mode text,question_item_id text,question_item_sha256 text,source_example_content_hash text);
      create table private.assignment_study_examples_v1(release_id text,vocab_entry_id bigint,question_item_id text,question_item_sha256 text,source_example_sha256 text,example_en text);
      create table private.vocabulary_composition_entries(version_id uuid,vocab_entry_id bigint,resources jsonb);
      create table private.reviewed_exam_entries(release_id text,vocab_entry_id bigint,entry_sha256 text,payload jsonb);
      create function private.is_active_admin() returns boolean language sql as $$select true$$;
      insert into students(id) values('${student}'),('${other}');
      insert into vocab_datasets values('${dataset}','검사용 책',null);
    `);
    await db.exec(fs.readFileSync(path.resolve("supabase/migrations/20260921020000_page_student_wrong_words.sql"),"utf8"));
    await db.exec(sql);
    let event=0;
    for(let n=1;n<=25;n++){
      await db.query("insert into vocab_entries values($1,$2,$3,$3,$4,'기존발음')",[n,dataset,"word"+n,"현재뜻"+n]);
      await db.query("insert into assignment_questions(id,vocab_entry_id,headword_snapshot,primary_meaning_snapshot,provenance_status) values($1,$2,$3,$4,'verified_v2')",[id(100+n),n,"word"+n,"출제당시뜻"+n]);
      await db.query("insert into quiz_questions(id,vocab_entry_id,assignment_question_id,initial_is_correct,retry_is_correct,direction,prompt,choices,correct_choice_index) values($1,$2,$3,false,true,'english_to_korean',$4,jsonb_build_array($5::text,'둘','셋','넷'),0)",[id(200+n),n,id(100+n),"word"+n,"출제당시뜻"+n]);
      for(let k=0;k<(n-1)%5+1;k++)await db.query("insert into student_vocab_wrong_events values($1,$2,$3,$4,$5,$6,$7,null,'initial','2026-09-29T10:00:00.123456Z')",[++event,student,id(900),id(200+n),dataset,n,"word"+n]);
    }
    await db.exec(`insert into student_vocab_wrong_events select 76,'${other}',quiz_attempt_id,quiz_question_id,dataset_id,vocab_entry_id,canonical_dictionary_id_snapshot,canonical_lexeme_id_snapshot,'initial',wrong_at from student_vocab_wrong_events where id=1;
      insert into student_vocab_wrong_events select 77,student_id,quiz_attempt_id,quiz_question_id,dataset_id,vocab_entry_id,canonical_dictionary_id_snapshot,canonical_lexeme_id_snapshot,'retry',wrong_at from student_vocab_wrong_events where id=1;`);
  },30000);
  afterAll(async()=>{await db.close();});
  async function page(input:{who?:string;sort?:string;after?:Item;upper?:string;key?:string;min?:number;max?:number;size?:number}={}){
    return (await db.query<{value:Page|null}>("select get_student_wrong_word_notebook_page_v2($1,null,'all','',$2,$3,$4,$5,$6,$7,$8,$9,$10) as value",
      [input.who??student,input.upper??null,input.after?.lastWrongAt??null,input.after?.key??null,input.min??null,input.max??null,input.sort??'count',input.after?.wrongCount??null,input.key??null,input.size??11])).rows[0].value;
  }
  it("전체25개를 횟수순으로 정렬하고 동률에도10+10+5로 누락없이 조회한다",async()=>{
    const first=(await page())!;const second=(await page({after:first.items[9],upper:first.eventUpperId}))!;const third=(await page({after:second.items[9],upper:first.eventUpperId}))!;
    const words=[...first.items.slice(0,10),...second.items.slice(0,10),...third.items];
    expect(words).toHaveLength(25);expect(new Set(words.map(w=>w.key)).size).toBe(25);
    expect(words.map(w=>w.wrongCount)).toEqual([...words.map(w=>w.wrongCount)].sort((a,b)=>b-a));
    expect(first.notebookSummary).toEqual({wordCount:25,wrongEventCount:75,repeatedWordCount:20});
    expect(second.totalCount).toBeNull();expect(third.items).toHaveLength(5);
  });
  it("최근순도 안정 정렬, 정확횟수/구간은 전체에서 적용한다",async()=>{
    const recent=(await page({sort:'recent',size:501}))!;
    expect(recent.items.map(w=>w.key)).toEqual([...recent.items.map(w=>w.key)].sort());
    expect((await page({min:4,max:4}))?.totalCount).toBe(5);
    expect((await page({min:2,max:4}))?.totalCount).toBe(15);
  });
  it("새 오답은 기존 페이지 중간에 끼지 않고 재조회에만 반영된다",async()=>{
    const before=(await page())!;await db.exec('begin');
    try{
      await db.exec("insert into student_vocab_wrong_events select 100,student_id,quiz_attempt_id,quiz_question_id,dataset_id,vocab_entry_id,canonical_dictionary_id_snapshot,canonical_lexeme_id_snapshot,'initial','2026-09-30T00:00:00Z' from student_vocab_wrong_events where id=1");
      expect(await page({upper:before.eventUpperId})).toEqual(before);
      expect((await page({key:'dictionary:word1'}))?.items[0].wrongCount).toBe(2);
    }finally{await db.exec('rollback');}
  });
  it("전체목록에 보이지 않는 단어도 본인 상세는 되고 타인 상세는 비어 있다",async()=>{
    expect((await page({key:'dictionary:word2'}))?.items[0]).toMatchObject({headword:'word2',primaryMeaning:'출제당시뜻2',studySource:{entryId:2,displayKo:'기존발음'}});
    expect((await page({who:other,key:'dictionary:word2'}))?.items).toEqual([]);
    expect((await page({who:other}))?.totalCount).toBe(1);
  });
  it("검수 영영풀이 양방향과 고정 조합값을 연결하되 해시가 다르면 사용하지 않는다",async()=>{
    await db.exec('begin');try{
      await db.exec(`insert into private.reviewed_exam_entries values('verified',2,'abcd','{"english_definition":"a verified definition"}');
        update assignment_questions set provenance_status='exam_reviewed_v1',reviewed_exam_release_id_snapshot='verified',entry_row_sha256_snapshot='ABCD',eligibility_quiz_mode='canonical_headword_to_definition' where vocab_entry_id=2;`);
      expect((await page({key:'dictionary:word2'}))?.items[0].studySource.definition).toBe('a verified definition');
      await db.exec("update assignment_questions set eligibility_quiz_mode='canonical_definition_to_headword' where vocab_entry_id=2");
      expect((await page({key:'dictionary:word2'}))?.items[0].studySource.definition).toBe('a verified definition');
      await db.exec("update assignment_questions set entry_row_sha256_snapshot='DIFFERENT' where vocab_entry_id=2");
      expect((await page({key:'dictionary:word2'}))?.items[0].studySource.definition).toBeNull();
      await db.exec(`insert into private.vocabulary_composition_entries values('${id(800)}',2,'{"selected":{"definitionEn":"fixed definition","exampleEn":"A fixed example.","exampleKo":"고정 예문"}}');
        update assignment_questions set provenance_status='composition_verified_v1',composition_version_id_snapshot='${id(800)}',composition_pronunciation_snapshot='{"target":{"displayText":"고정발음","audioUrl":"https://example.test/approved.mp3"}}' where vocab_entry_id=2;`);
      expect((await page({key:'dictionary:word2'}))?.items[0].studySource).toMatchObject({definition:'fixed definition',example:'A fixed example.',exampleKo:'고정 예문',compositionPronunciation:{displayText:'고정발음'}});
    }finally{await db.exec('rollback');}
  });
  it("사전 연결 없는 옛 오답도 저장된 시험에서 복원해 현재 사전 수정에 흔들리지 않는다",async()=>{
    await db.exec('begin');try{
      await db.exec("update student_vocab_wrong_events set canonical_dictionary_id_snapshot=null where vocab_entry_id=2; update assignment_questions set headword_snapshot=null,primary_meaning_snapshot=null,provenance_status='legacy_backfill' where vocab_entry_id=2");
      const key=`headword:${dataset}:word2`;const before=await page({key});
      expect(before?.items[0]).toMatchObject({headword:'word2',primaryMeaning:'출제당시뜻2'});
      await db.exec("update vocab_entries set headword='changed',headword_normalized='changed',primary_meaning='변경 뜻' where id=2");
      expect((await page({key,upper:before?.eventUpperId}))?.items.map(({key,headword,primaryMeaning,wrongCount})=>({key,headword,primaryMeaning,wrongCount}))).toEqual(before?.items.map(({key,headword,primaryMeaning,wrongCount})=>({key,headword,primaryMeaning,wrongCount})));
    }finally{await db.exec('rollback');}
  });
  it("읽기 전후 자료가 같고 미인증 직접호출/잘못된 조건은 거절한다",async()=>{
    const snapshot=async()=>(await db.query("select jsonb_agg(t order by id) as data from student_vocab_wrong_events t")).rows;
    const before=await snapshot();await page();await page({sort:'recent'});expect(await snapshot()).toEqual(before);
    for(const role of ['anon','authenticated']){await db.exec('set role '+role);try{await expect(page()).rejects.toMatchObject({code:'42501'});}finally{await db.exec('reset role');}}
    await db.exec('set role service_role');try{expect((await page())?.totalCount).toBe(25);}finally{await db.exec('reset role');}
    await expect(page({sort:'invalid'})).rejects.toMatchObject({code:'22023'});
    await expect(page({min:5,max:2})).rejects.toMatchObject({code:'22023'});
    await expect(page({size:502})).rejects.toMatchObject({code:'22023'});
    await db.exec(`update students set status='blocked' where id='${student}'`);expect(await page()).toBeNull();
  });
});
it("현재 최종 스키마에서 새 조회 함수가 실제 실행된다",async()=>{
  const db=await createFinalSchemaDatabase();
  try{
    await db.exec(`insert into auth.users(id) values('${id(8)}');insert into admin_profiles(user_id,display_name,is_active) values('${id(8)}','가짜 관리자',true);insert into students(id,display_name,status,created_by) values('${student}','가짜 학생','active','${id(8)}');`);
    expect((await db.query<{value:Page}>("select get_student_wrong_word_notebook_page_v2($1) as value",[student])).rows[0].value.items).toEqual([]);
  }finally{await db.close();}
},120000);
