import fs from "node:fs";
import path from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { beforeAll, afterAll, describe, expect, it } from "vitest";
import { buildStudentWrongWordHistory, type WrongEntrySource, type WrongEventSource, type WrongQuestionSource } from "@/lib/admin/wrong-word-history";
import { wrongWordItemSchema } from "@/features/students/contracts/wrong-word-page";

const uuid = (value: number) => `00000000-0000-4000-8000-${String(value).padStart(12, "0")}`;
const student = uuid(1), dataset = uuid(2), otherDataset = uuid(3);
const migration = fs.readFileSync(path.resolve("supabase/migrations/20260921020000_page_student_wrong_words.sql"), "utf8");
describe.sequential("paged wrong word history preserves full aggregation", () => {
  let db: PGlite;
  const entries: WrongEntrySource[] = [], events: WrongEventSource[] = [], questions: WrongQuestionSource[] = [];
  beforeAll(async () => {
    db = new PGlite();
    await db.exec(`
      create role anon; create role authenticated; create role service_role;
      create schema private;
      create function private.is_active_admin() returns boolean language sql as $$ select coalesce(current_setting('app.admin',true),'')='yes' $$;
      create table public.students(id uuid primary key,deleted_at timestamptz);
      create table public.vocab_datasets(id uuid primary key,title text,edition text);
      create table public.vocab_entries(id bigint primary key,dataset_id uuid,headword text,headword_normalized text,primary_meaning text);
      create table public.assignments(id uuid primary key,dataset_id uuid,status text,title text);
      create table public.assignment_students(assignment_id uuid,student_id uuid,assigned_at timestamptz,cancelled_at timestamptz,missed_at timestamptz);
      create table public.assignment_questions(id uuid primary key,assignment_id uuid,dataset_id uuid,vocab_entry_id bigint,canonical_lexeme_id_snapshot uuid,headword_normalized_snapshot text,headword_snapshot text,primary_meaning_snapshot text,provenance_status text);
      create table public.assignment_question_exam_use_snapshot(assignment_question_id uuid primary key,dictionary_id text,headword_snapshot text,primary_meaning_snapshot text,provenance_status text);
      create table public.quiz_attempts(id uuid primary key,assignment_id uuid,student_id uuid,status text);
      create table public.quiz_questions(id uuid primary key,vocab_entry_id bigint,assignment_question_id uuid,initial_is_correct boolean,retry_is_correct boolean);
      create table public.student_vocab_wrong_events(id bigint primary key,student_id uuid,quiz_attempt_id uuid,quiz_question_id uuid,dataset_id uuid,vocab_entry_id bigint,canonical_dictionary_id_snapshot text,canonical_lexeme_id_snapshot uuid,wrong_stage text,wrong_at timestamptz);
      create table public.student_vocab_state(student_id uuid,vocab_entry_id bigint,unresolved_wrong_count integer,resolved_at timestamptz,last_evaluated_at timestamptz,primary key(student_id,vocab_entry_id));
      create table public.student_vocab_review_queue_read_v1(id uuid,student_id uuid,dataset_id uuid,vocab_entry_id bigint,canonical_dictionary_id_snapshot text,canonical_lexeme_id_snapshot uuid,source_question_id uuid,reason_level smallint,queued_at timestamptz,active_review_draft_id uuid,status text);
      insert into public.students values ('${student}',null),('${uuid(9)}',null);
      insert into public.vocab_datasets values ('${dataset}','검사 단어장',null),('${otherDataset}','다른 출처',null);
      set app.admin='yes';
    `);
    await db.exec(migration);
    for (let n=1; n<=24; n++) {
      const questionId=uuid(100+n), attemptId=uuid(200+n), aq=uuid(300+n);
      const d=n===24?otherDataset:dataset;
      const dictionary=n===24?"shared":"word-"+n;
      const wrongAt=`2026-09-${String(n===24?22:n).padStart(2,"0")}T10:00:00.000Z`;
      const headword=n===24?"Shared":"Word "+n;
      entries.push({id:n,datasetId:d,datasetLabel:n===24?"다른 출처":"검사 단어장",headword,headwordNormalized:headword,primaryMeaning:"뜻 "+n});
      questions.push({id:questionId,vocabEntryId:n,initialIsCorrect:false,retryIsCorrect:n===3?true:null,headword,primaryMeaning:"뜻 "+n,provenanceStatus:"verified_v2"});
      events.push({attemptId,questionId,datasetId:d,vocabEntryId:n,canonicalDictionaryId:n===2?"shared":dictionary,canonicalLexemeId:null,stage:"initial",wrongAt});
      await db.query("insert into public.vocab_entries values ($1,$2,$3,$3,$4)",[n,d,headword,"뜻 "+n]);
      await db.query("insert into public.assignment_questions(id,headword_snapshot,primary_meaning_snapshot,provenance_status) values ($1,$2,$3,'verified_v2')",[aq,headword,"뜻 "+n]);
      await db.query("insert into public.quiz_questions values ($1,$2,$3,false,$4)",[questionId,n,aq,n===3?true:null]);
      await db.query("insert into public.student_vocab_wrong_events values ($1,$2,$3,$4,$5,$6,$7,null,'initial',$8)",[n,student,attemptId,questionId,d,n,n===2?"shared":dictionary,wrongAt]);
    }
    // A repeated initial event in the SAME attempt must still count twice.
    events.push({...events[0],wrongAt:"2026-09-21T10:00:00.000Z"});
    await db.exec(`insert into public.student_vocab_wrong_events select 25,student_id,quiz_attempt_id,quiz_question_id,dataset_id,vocab_entry_id,canonical_dictionary_id_snapshot,canonical_lexeme_id_snapshot,wrong_stage,'2026-09-21T10:00:00Z' from public.student_vocab_wrong_events where id=1`);
    // A retry event and another student's initial event do not contribute.
    await db.exec(`insert into public.student_vocab_wrong_events select 26,student_id,quiz_attempt_id,quiz_question_id,dataset_id,vocab_entry_id,canonical_dictionary_id_snapshot,canonical_lexeme_id_snapshot,'retry',wrong_at from public.student_vocab_wrong_events where id=1;
      insert into public.student_vocab_wrong_events select 27,'${uuid(9)}',quiz_attempt_id,quiz_question_id,dataset_id,vocab_entry_id,canonical_dictionary_id_snapshot,canonical_lexeme_id_snapshot,'initial',wrong_at from public.student_vocab_wrong_events where id=1;`);
  }, 30000);
  afterAll(async () => { await db.close(); });
  async function page(args: {dataset?:string;level?:string;query?:string;upper?:string;at?:string;key?:string}={}) {
    const result=await db.query<{page: {items: ReturnType<typeof wrongWordItemSchema.parse>[]; eventUpperId:string; totalCount:number|null; summary:unknown; datasetOptions:unknown; reviewDrafts:unknown}}>(
      "select public.get_admin_student_wrong_word_page_v1($1,$2,$3,$4,$5,$6,$7) as page",[student,args.dataset??null,args.level??"all",args.query??"",args.upper??null,args.at??null,args.key??null]);
    return result.rows[0].page;
  }
  it("preserves every aggregate, full counts, cross-dataset occurrences and retry outcome", async () => {
    const old=buildStudentWrongWordHistory({entries,events:events.toReversed(),questions});
    const first=await page();
    expect(first.items).toHaveLength(11);
    expect(first.summary).toEqual({wrongEventCount:old.wrongEventCount,uniqueWordCount:old.uniqueWordCount,onceWrongWordCount:old.onceWrongWordCount,repeatedWrongWordCount:old.repeatedWrongWordCount,pendingReviewCount:old.pendingReviewCount});
    const all = [...first.items.slice(0,10)];
    let current=first;
    while(current.items.length===11) {
      const last=current.items[9];
      current=await page({upper:first.eventUpperId,at:last.lastWrongAt,key:last.key});
      expect(current.summary).toBeNull(); expect(current.totalCount).toBeNull();
      all.push(...current.items.slice(0,10));
    }
    expect(all).toHaveLength(old.words.length);
    expect(new Set(all.map(item=>item.key)).size).toBe(old.words.length);
    const canonical=(value:unknown):unknown => {
      if(Array.isArray(value)) return value.map(canonical);
      if(value && typeof value==="object") return Object.fromEntries(Object.entries(value).map(([key,v])=>[key,/At$/.test(key)&&typeof v==="string"?new Date(v).toISOString():canonical(v)]));
      return value;
    };
    for(const item of all) {
      wrongWordItemSchema.parse(item);
      expect(canonical(item)).toEqual(canonical(old.words.find(word=>word.key===item.key)));
    }
    expect(all.map(word=>Date.parse(word.lastWrongAt))).toEqual(all.map(word=>Date.parse(word.lastWrongAt)).toSorted((a,b)=>b-a));
  });
  it("filters AFTER cross-dataset aggregation without losing history counts", async () => {
    const result=await page({dataset:otherDataset,level:"repeated",query:"다른 출처"});
    expect(result.totalCount).toBe(1);
    expect(result.items[0]).toMatchObject({key:"dictionary:shared",wrongCount:2});
    expect(result.items[0].occurrences).toHaveLength(2);
    expect(result.summary).toMatchObject({wrongEventCount:25});
    expect((await page({level:"once",query:"Word 1"})).items.every(word=>word.wrongCount===1)).toBe(true);
  });
  it("keeps active assignment, queue and resolved state distinct on a filtered page", async () => {
    await db.exec("begin");
    try {
      await db.exec(`insert into public.assignments values('${uuid(501)}','${dataset}','open','가짜 오답 배정');
        insert into public.assignment_students values('${uuid(501)}','${student}','2026-09-21T00:00:00Z',null,null);
        insert into public.assignment_questions(id,assignment_id,dataset_id,vocab_entry_id,headword_normalized_snapshot) values('${uuid(502)}','${uuid(501)}','${dataset}',12,'Word 12');
        insert into public.assignment_question_exam_use_snapshot(assignment_question_id,dictionary_id) values('${uuid(502)}','word-12');
        insert into public.student_vocab_review_queue_read_v1 values('${uuid(503)}','${student}','${dataset}',13,'word-13',null,'${uuid(113)}',1,'2026-09-21T00:00:00Z',null,'pending');
        insert into public.student_vocab_state values('${student}',14,0,'2026-09-21T00:00:00Z','2026-09-21T00:00:00Z');`);
      expect((await page({query:"Word 12"})).items[0]).toMatchObject({scheduling:"assigned",activeAssignment:{assignmentId:uuid(501),title:"가짜 오답 배정"}});
      const queued=await page({query:"Word 13"});
      expect(queued.items[0].scheduling).toBe("queued");
      expect(queued.summary).toMatchObject({pendingReviewCount:1,uniqueWordCount:21});
      expect((await page({query:"Word 14"})).items[0]).toMatchObject({resolution:"resolved",scheduling:"none"});
      await db.exec(`update public.assignment_students set cancelled_at=now() where assignment_id='${uuid(501)}'`);
      expect((await page({query:"Word 12"})).items[0].scheduling).toBe("available");
    } finally { await db.exec("rollback"); }
  });
  it("preserves the old empty reviewed text fallback to the event entry",async()=>{
    await db.exec("begin");
    try {
      await db.exec(`update public.assignment_questions set headword_snapshot='untrusted-fallback',primary_meaning_snapshot='other meaning' where id='${uuid(313)}';
        insert into public.assignment_question_exam_use_snapshot values('${uuid(313)}',null,'','','reviewed_for_preview_v1')`);
      expect((await page({query:"Word 13"})).items[0]).toMatchObject({headword:"Word 13",primaryMeaning:"뜻 13"});
    } finally { await db.exec("rollback"); }
  });
  it("keeps an event upper bound stable across a new event and rejects unauthorised reads", async () => {
    const first=await page();
    await db.exec("insert into public.student_vocab_wrong_events select 28,student_id,quiz_attempt_id,quiz_question_id,dataset_id,vocab_entry_id,canonical_dictionary_id_snapshot,canonical_lexeme_id_snapshot,'initial','2026-09-30T00:00:00Z' from public.student_vocab_wrong_events where id=4");
    const frozen=await page({upper:first.eventUpperId});
    expect(frozen).toEqual(first);
    expect((await page()).items[0].key).toBe("dictionary:word-4");
    await db.exec("set role authenticated; set app.admin='no'");
    await expect(page()).rejects.toMatchObject({code:"42501"});
    await db.exec("reset role; set app.admin='yes'");
    const grants=await db.query<{allowed:boolean}>("select has_function_privilege('anon','public.get_admin_student_wrong_word_page_v1(uuid,uuid,text,text,bigint,timestamptz,text)','execute') as allowed");
    expect(grants.rows[0].allowed).toBe(false);
  });
});
