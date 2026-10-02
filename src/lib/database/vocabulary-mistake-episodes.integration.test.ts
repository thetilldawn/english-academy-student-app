import type { PGlite } from "@electric-sql/pglite";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createFinalSchemaDatabase } from "@/test-support/final-schema-database";
import { buildMistakePracticePlan, mistakePracticeSourceSchema } from "@/features/quiz-player/domain/mistake-practice-plan";
import type { PracticeSettings } from "@/features/quiz-player/contracts/practice";
import type { QuizAttemptResponse } from "@/features/quiz-player/model";
import type { AdminMistakePage } from "@/features/students/contracts/mistake-episode";
import type { MistakeEpisodeHistoryPage } from "@/features/students/contracts/mistake-episode-history";

const id = (n: number) => `a3030000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const admin = id(1), student = id(2), other = id(3), dataset = id(4), unit = id(5);
type Answer = { completed: boolean; needsRetry: boolean; [key: string]: unknown };
type State = { meaning_key: string; episode_id: string; unresolved: boolean; current_wrong_count: number; lifetime_wrong_count: number; current_missed_count: number; lifetime_missed_count: number; last_sequence: number };
type FakeExam = { assignment: string; attempt: string; questions: string[] };
type MistakePage = { totalCount: number; stateVersion: string; sourceVersion: string; summary: { wordCount: number; currentWrongCount: number; lifetimeWrongCount: number }; items: { key: string; sourceVersion: string; currentWrongCount: number; lifetimeWrongCount: number; meanings: { meaningKey: string; unresolved: boolean }[]; cursor: Record<string, unknown> }[] };

describe.sequential("뜻별 오답 접수와 현재 구간", () => {
  let db: PGlite;
  beforeAll(async () => {
    db = await createFinalSchemaDatabase();
    await db.exec(`grant usage on schema auth,extensions to service_role; alter role service_role bypassrls;
      begin;
      select set_config('request.jwt.claim.sub','${admin}',true);
      select set_config('request.jwt.claim.role','authenticated',true);
      insert into auth.users(id) values('${admin}');
      insert into public.admin_profiles(user_id,display_name,is_active) values('${admin}','가짜 관리자',true);
      insert into public.students(id,display_name,status,created_by) values('${student}','가짜 오답 학생','active','${admin}'),('${other}','다른 가짜 학생','active','${admin}');
      insert into public.vocab_datasets(id,dataset_key,title,source_label,source_sha256,row_count,status,imported_by)
        values('${dataset}','m03-fake','가짜 오답 자료','가짜',repeat('A',64),4,'ready','${admin}');
      insert into public.vocab_units(id,dataset_id,unit_label,normalized_label,unit_kind,unit_number,sort_index,entry_count)
        values('${unit}','${dataset}','DAY 1','day 1','day',1,1,4);
      insert into public.vocab_entries(dataset_id,source_row,headword,headword_normalized,meanings,primary_meaning,row_sha256,unit_id,position_in_unit,entry_type)
        select '${dataset}',n,'fakeword'||n,'fakeword'||n,array['가짜 뜻'||n],'가짜 뜻'||n,repeat('B',63)||n::text,'${unit}',n,'word' from generate_series(1,4)n;
      commit;`);
  }, 120_000);
  beforeEach(async () => { await db.exec("begin"); });
  afterEach(async () => { await db.exec("rollback; reset role"); });
  afterAll(async () => { await db?.close(); });
  async function rows<T = Record<string, unknown>>(sql: string, args: unknown[] = []) { return (await db.query<T>(sql, args)).rows; }
  async function service<T>(sql: string, args: unknown[] = []) {
    await db.exec("select set_config('request.jwt.claim.role','service_role',true); set local role service_role");
    const result = await rows<T>(sql, args);
    await db.exec("reset role");
    return result;
  }
  async function asAdmin<T>(sql: string, args: unknown[] = []) {
    await db.exec(`select set_config('request.jwt.claim.sub','${admin}',true); select set_config('request.jwt.claim.role','authenticated',true); set local role authenticated`);
    const result = await rows<T>(sql, args); await db.exec("reset role"); return result;
  }
  async function targets(qs: string[]) {
    return (await rows<{ value: Record<string, unknown>[] }>(`select jsonb_agg(jsonb_build_object('sourceQuestionId',r.quiz_question_id,'sourcePhase',r.phase,
      'meaningKey',r.meaning_key,'episodeId',s.episode_id,'stateVersion',v.version::text) order by r.server_sequence) value
      from private.vocabulary_answer_receipts r join private.student_vocabulary_meaning_states s on s.student_id=r.student_id and s.meaning_key=r.meaning_key
      join private.student_vocabulary_versions v on v.student_id=r.student_id where r.quiz_question_id=any($1::uuid[]) and r.outcome<>'correct'`, [qs]))[0].value;
  }
  async function queue(qs: string[]) {
    return (await asAdmin<{ value: string[] }>("select public.queue_student_vocabulary_mistakes_v1($1,$2) value", [student, JSON.stringify(await targets(qs))]))[0].value;
  }
  async function fails(action: () => Promise<unknown>, message: string) {
    await db.exec("savepoint expected_failure");
    try { await expect(action()).rejects.toThrow(message); }
    finally { await db.exec("rollback to expected_failure; release expected_failure"); }
  }
  // Legacy-shaped fake banks isolate answer/episode processing. Public source
  // approval and cross-book approved binding tests are separate requirements.
  async function exam(n: number, options: { meaning?: string; timing?: "none" | "per_question"; retry?: boolean;
    dataset?: string; unit?: string; release?: string; testedField?: "definition" | "example" } = {}) {
    const dataset = options.dataset ?? id(4), unit = options.unit ?? id(5);
    const assignment = id(n), attempt = id(n + 1000);
    await db.query(`insert into assignments(id,title,dataset_id,range_start,range_end,question_count,english_to_korean_ratio,time_limit_seconds,
      timing_mode,question_time_limit_seconds,passing_score,status,created_by,retake_allowed,range_basis,question_bank_version,retry_enabled)
      values($1,'가짜 정규 시험',$2,1,4,4,100,240,$4,case when $4='per_question' then 5 else null end,80,'active',$3,true,'units',1,$5)`,
    [assignment, dataset, admin, options.timing ?? "none", options.retry ?? true]);
    await db.query("insert into assignment_units(assignment_id,dataset_id,unit_id,position,is_primary) values($1,$2,$3,1,true)", [assignment, dataset, unit]);
    await db.query("insert into assignment_students(assignment_id,student_id,assigned_by) values($1,$2,$3)", [assignment, student, admin]);
    await db.query(`insert into assignment_questions(assignment_id,dataset_id,vocab_entry_id,base_order_index,direction,prompt,choices,correct_choice_index,
      headword_snapshot,primary_meaning_snapshot,choice_vocab_entry_ids,entry_row_sha256_snapshot)
      select $1,$2,e.id,e.source_row,'english_to_korean',e.headword,
      (select jsonb_agg(case when v.source_row=1 then coalesce($3,v.primary_meaning) else v.primary_meaning end order by source_row) from vocab_entries v where v.dataset_id=$2),(e.source_row-1)::smallint,
      e.headword,case when e.source_row=1 then coalesce($3,e.primary_meaning) else e.primary_meaning end,
      (select array_agg(id order by source_row) from vocab_entries where dataset_id=$2),e.row_sha256
      from vocab_entries e where e.dataset_id=$2`, [assignment, dataset, options.meaning ?? null]);
    if (options.testedField) await db.query(`update assignment_questions set eligibility_quiz_mode=$2,
      choices=jsonb_build_array($3::text,'other 1','other 2','other 3'),correct_choice_index=0 where assignment_id=$1 and base_order_index=1`,
    [assignment, options.testedField === "definition" ? "canonical_headword_to_definition" : "canonical_example_to_headword", options.testedField === "definition" ? "an English definition" : "fakeword1"]);
    if (options.testedField === "example") await db.query(`update assignment_questions set prompt='This is an example with _____.',direction='korean_to_english'
      where assignment_id=$1 and base_order_index=1`, [assignment]);
    if (options.release) await attachRelease(assignment, options.release);
    await db.query("select private.finalize_assignment_question_body_refs_v1($1)", [assignment]);
    await db.query(`insert into quiz_attempts(id,student_id,assignment_id,attempt_number,started_at,deadline_at,current_question_started_at,question_count_snapshot,
      time_limit_seconds_snapshot,passing_score_snapshot,passing_basis_snapshot,retry_enabled_snapshot,retry_passing_score_snapshot)
      values($1,$2,$3,1,clock_timestamp()-interval '1 second','infinity',clock_timestamp()-interval '1 second',4,240,80,'initial',$4,80)`,
    [attempt, student, assignment, options.retry ?? true]);
    await db.query(`insert into quiz_questions(attempt_id,assignment_question_id,vocab_entry_id,order_index,direction,correct_choice_index,content_version_id)
      select $1,id,vocab_entry_id,base_order_index,direction,correct_choice_index,content_version_id from assignment_questions where assignment_id=$2`, [attempt, assignment]);
    const questions = await rows<{ id: string; order_index: number }>("select id,order_index from quiz_questions where attempt_id=$1 order by order_index", [attempt]);
    return { assignment, attempt, questions: questions.map(q => q.id) };
  }
  async function seedRelease(source: string, release: string, approved = true) {
    await db.query(`insert into word_index.app_exam_use_release(release_id,release_key,dataset_id,dataset_key,schema_version,
      package_version,source_sha256,candidate_dictionary_version,manifest_content_hash,exam_review_ledger_sha256,wordbook_id,title,target_environment,
      common_dictionary_release_allowed,exam_use_import_allowed,expected_occurrence_count,expected_dictionary_count,expected_included_count,status,package_json)
      select $2::uuid,'m03-fake:'||$2::text,d.id,d.dataset_key,'1.0',encode(extensions.digest($2::text,'sha256'),'hex'),d.source_sha256,repeat('a',64),repeat('b',64),repeat('c',64),
      'm03-fake','가짜 뜻 승인 검사','preview',false,true,4,4,4,'active','{}' from vocab_datasets d where d.id=$1`, [source, release]);
    await db.query(`insert into word_index.app_exam_use_occurrence(release_id,dataset_id,source_row,vocab_entry_id,unit_id,position_in_unit,
      dictionary_id,sense_id,display_headword,display_gloss_ko,display_pronunciation_review_status,audio_status,listening_enabled,
      occurrence_id,occurrence_content_hash,package_entry_content_hash,exam_review_id,exam_input_hash,exam_use_status,context_evidence_status,context_evidence,
      source_projection_row_sha256,source_entry_id,source_entry_sha256,include_in_exam,audio_json,package_entry_json)
      select $2::uuid,e.dataset_id,e.source_row,e.id,e.unit_id,e.position_in_unit,'word:m03-shared-'||e.source_row,'m03-fake-noun-'||e.source_row,
      e.headword,e.primary_meaning,'candidate','disabled',false,'occ:m03-'||$2::text||'-'||e.source_row,lower(e.row_sha256),lower(e.row_sha256),
      'exam-review:m03-'||$2::text||'-'||e.source_row,lower(e.row_sha256),'reviewed_for_preview','source_entry_context',
      jsonb_build_object('source','source_entries','source_entry_id','m03-entry-'||e.id,'source_entry_sha256',lower(e.row_sha256)),
      e.row_sha256,'m03-entry-'||e.id,lower(e.row_sha256),true,'{"status":"disabled"}','{}' from vocab_entries e where e.dataset_id=$1`, [source, release]);
    if (approved) await approveRelease(source, release);
  }
  async function approveRelease(source: string, release: string) {
    await db.query(`insert into word_index.mock_wordbook_identity_review(source_release_id,source_entry_id,source_row_sha256,
      reviewed_headword,reviewed_gloss,lexical_pos,sense_id,review_evidence_sha256)
      select $2,e.id,e.row_sha256,e.headword,e.primary_meaning,'noun','m03-fake-noun-1',repeat('d',64)
      from vocab_entries e where e.dataset_id=$1 and e.source_row=1`, [source, release]);
  }
  async function attachRelease(assignment: string, release: string) {
    await db.query(`update assignment_questions q set question_content_sha256=upper(encode(extensions.digest(
      jsonb_build_array(q.direction,q.prompt,q.choices,q.correct_choice_index,q.entry_row_sha256_snapshot,q.headword_snapshot,q.primary_meaning_snapshot)::text,'sha256'),'hex'))
      where q.assignment_id=$1 and q.content_version_id is null`, [assignment]);
    await db.query(`with occurrences as (select o.*,jsonb_build_object('dictionaryId',o.dictionary_id,'displayHeadword',o.display_headword,'displayGlossKo',o.display_gloss_ko,
      'displayPronunciationKo',o.display_pronunciation_ko,'pronunciationVariantId',o.pronunciation_variant_id,'audioStatus',o.audio_status,'audioUrl',o.audio_url,
      'soundAudio',o.sound_audio,'rawResponseSha256',o.raw_response_sha256,'listeningEnabled',o.listening_enabled,'reviewStatus',o.display_pronunciation_review_status) pronunciation
      from word_index.app_exam_use_occurrence o where o.release_id=$2)
      insert into assignment_question_exam_use_snapshot(assignment_question_id,assignment_id,dataset_id,vocab_entry_id,release_id,dictionary_id,occurrence_id,sense_id,exam_review_id,
      headword_snapshot,primary_meaning_snapshot,pronunciation_snapshot,choice_dictionary_snapshots,occurrence_content_hash,question_content_sha256,provenance_status)
      select q.id,q.assignment_id,q.dataset_id,q.vocab_entry_id,o.release_id,o.dictionary_id,o.occurrence_id,o.sense_id,o.exam_review_id,o.display_headword,o.display_gloss_ko,o.pronunciation,
      (select jsonb_agg(c.pronunciation||jsonb_build_object('choiceIndex',pick.ord-1,'vocabEntryId',c.vocab_entry_id,'senseId',c.sense_id,'occurrenceContentHash',c.occurrence_content_hash) order by pick.ord)
      from unnest(q.choice_vocab_entry_ids) with ordinality pick(entry_id,ord) join occurrences c on c.vocab_entry_id=pick.entry_id),
      upper(o.occurrence_content_hash),q.question_content_sha256,'reviewed_for_preview_v1'
      from assignment_questions q join occurrences o on o.vocab_entry_id=q.vocab_entry_id and o.dataset_id=q.dataset_id where q.assignment_id=$1`, [assignment, release]);
  }
  async function answer(exam: FakeExam, index: number, choice: number, phase = "initial", version = 4, force = false) {
    const fn = "answer_quiz_question" + (version === 1 ? "" : `_v${version}`);
    const sql = `select public.${fn}($1,$2,$3,$4,$5::smallint${version === 1 ? "" : ",$6"}) value`;
    const args = [student, exam.attempt, exam.questions[index], phase, choice];
    return (await service<{ value: Answer }>(sql, version === 1 ? args : [...args, force]))[0].value;
  }
  async function ready(exam: FakeExam) {
    // Explicitly advance fake clock state between accepted questions; no wall
    // clock sleeps, and production feedback duration itself is not changed.
    await db.query("update quiz_attempts set current_question_started_at=clock_timestamp()-interval '1 second' where id=$1", [exam.attempt]);
  }
  async function state(question: string) {
    return (await rows<State>("select s.* from private.student_vocabulary_meaning_states s where s.student_id=$1 and s.meaning_key=private.quiz_vocabulary_meaning_v1($2)->>'meaningKey'", [student, question]))[0];
  }
  async function page(filters: Record<string, unknown> = {}, cursor: unknown = null) {
    return (await service<{ value: MistakePage }>("select public.get_student_vocabulary_mistake_page_v1($1,$2,$3) value", [student, JSON.stringify(filters), cursor === null ? null : JSON.stringify(cursor)]))[0].value;
  }
  async function wrongThenRetry(e: Awaited<ReturnType<typeof exam>>) {
    for (let i = 0; i < 4; i++) { await ready(e); await answer(e, i, (i + 1) % 4); }
    await service("select public.start_quiz_retry_v2($1,$2)", [student, e.attempt]);
    await ready(e); return answer(e, 0, 1, "retry");
  }
  it("같은 동결 선택을 여러 배정에서 최초/재시험 실패하면 4회이며 해결 뒤 새 구간은 1회다", async () => {
    const a = await exam(10), b = await exam(11), solve = await exam(12), again = await exam(13);
    await wrongThenRetry(a); await wrongThenRetry(b);
    const before = await state(a.questions[0]);
    expect(before).toMatchObject({ unresolved: true, current_wrong_count: 4, lifetime_wrong_count: 4, current_missed_count: 0 });
    const oldEpisode = before.episode_id;
    await answer(solve, 0, 0);
    expect(await state(a.questions[0])).toMatchObject({ unresolved: false, current_wrong_count: 0, lifetime_wrong_count: 4 });
    // A correct answer resolves this selection before the whole exam passes.
    expect((await rows("select status,passed from quiz_attempts where id=$1", [solve.attempt]))[0]).toEqual({ status: "in_progress", passed: null });
    await answer(again, 0, 1);
    const next = await state(a.questions[0]);
    expect(next).toMatchObject({ unresolved: true, current_wrong_count: 1, lifetime_wrong_count: 5 });
    expect(next.episode_id).not.toBe(oldEpisode);
    expect((await rows("select count(*)::int n from private.vocabulary_answer_receipts where meaning_key=$1 and outcome='wrong'", [next.meaning_key]))[0]).toEqual({ n: 5 });
  });
  it("지난 구간 정답 재전송은 원래 응답을 반환하고 새 오답을 해결하지 않는다", async () => {
    const a = await exam(20), solve = await exam(21), again = await exam(22);
    await answer(a, 0, 1); const saved = await answer(solve, 0, 0); await answer(again, 0, 1);
    const before = await state(a.questions[0]);
    expect(await answer(solve, 0, 0)).toEqual(saved);
    expect(await state(a.questions[0])).toEqual(before);
    await fails(() => answer(solve, 0, 1), "question_already_answered");
    expect(await state(a.questions[0])).toEqual(before);
  });
  it("지난 이력 더보기는 첫 조회 상한을 유지하고 해결·재오답 구간을 구분한다", async () => {
    const a = await exam(230), solve = await exam(231), again = await exam(232);
    await answer(a, 0, 1); await ready(a); await answer(a, 1, 2);
    const first = await page({ view: "history", pageSize: 1 });
    await answer(solve, 0, 0); await answer(again, 0, 1);
    const second = await page({ view: "history", pageSize: 1 }, first.items[0].cursor);
    expect(second.stateVersion).toBe(first.stateVersion);
    expect([...first.items, ...second.items]).toHaveLength(2);
    expect([...first.items, ...second.items].every(w => w.currentWrongCount === 1 && w.lifetimeWrongCount === 1)).toBe(true);
    const current = await page({ view: "history" });
    const key = (await state(a.questions[0])).meaning_key;
    const changed = current.items.flatMap(w => w.meanings).find(m => m.meaningKey === key);
    expect(changed).toMatchObject({ currentWrongCount: 1, lifetimeWrongCount: 2, episodeCount: 2,
      episodes: [{ wrongCount: 1, resolvedAt: null }, { wrongCount: 1, resolvedAt: expect.any(String) }] });
    expect((await page()).stateVersion).not.toBe(first.stateVersion);
  });
  it("뜻의 이력 20·21·40·41건을 같은 상한으로 끝까지 읽고 새 정답·재오답은 섞지 않는다", async () => {
    type RawHistory = Omit<MistakeEpisodeHistoryPage,"nextCursor"> & {nextCursor:Record<string,unknown>|null};
    const snapshots:{count:number;upper:string;meaningKey:string;first:RawHistory}[]=[];
    const read=async(meaningKey:string,upper:string,cursor:unknown=null)=>(await service<{value:RawHistory}>(
      "select public.get_student_vocabulary_mistake_episodes_v1($1,$2,$3,$4) value",[student,meaningKey,upper,cursor]))[0].value;
    for(let i=0;i<42;i++) {
      const wrong=await exam(600+i*2),correct=await exam(601+i*2);await answer(wrong,0,1);
      if([20,21,40,41].includes(i+1)) {
        const current=await state(wrong.questions[0]),upper=String(current.last_sequence);
        const first=await read(current.meaning_key,upper);
        snapshots.push({count:i+1,upper,meaningKey:current.meaning_key,first});
        const summary=(await rows<{history:{episodeCount:number;episodes:unknown[];episodeNextCursor:unknown}}>(
          "select history from private.vocabulary_mistake_episode_histories_v1($1,$2,$3)",[student,[current.meaning_key],upper]))[0].history;
        expect(summary).toEqual({episodeCount:i+1,episodes:first.items,episodeNextCursor:first.nextCursor});
      }
      await answer(correct,0,0);
    }
    const unchanged=async()=>rows("select (select count(*)::int from private.vocabulary_answer_receipts) receipts,version from private.student_vocabulary_versions where student_id=$1",[student]);
    const before=await unchanged();
    for(const snapshot of snapshots) {
      expect(await read(snapshot.meaningKey,snapshot.upper)).toEqual(snapshot.first);
      expect(snapshot.first.items[0].resolvedAt).toBeNull();
      let cursor=snapshot.first.nextCursor;const items=[...snapshot.first.items],sizes=[items.length];
      while(cursor) { const next=await read(snapshot.meaningKey,snapshot.upper,cursor);items.push(...next.items);sizes.push(next.items.length);cursor=next.nextCursor; }
      expect(items).toHaveLength(snapshot.count);expect(new Set(items.map(item=>item.episodeId)).size).toBe(snapshot.count);
      expect(sizes).toEqual(snapshot.count===20?[20]:snapshot.count===21?[20,1]:snapshot.count===40?[20,20]:[20,20,1]);
      expect(items.every(item=>item.wrongCount===1&&!item.includesLegacy)).toBe(true);
    }
    expect(await unchanged()).toEqual(before);
    const last=snapshots.at(-1)!,cursor=last.first.nextCursor!;
    for(const bad of [{...cursor,studentId:other},{...cursor,meaningKey:"e".repeat(64)},{...cursor,stateVersion:"0"},
      {...cursor,episodeId:id(9999)}]) await fails(()=>read(last.meaningKey,last.upper,bad),"wrong_history_changed");
    for(const bad of [{...cursor,extra:true},{...cursor,openedAt:null},{...cursor,lastSequence:"-1"}])
      await fails(()=>read(last.meaningKey,last.upper,bad),"invalid_wrong_history_cursor");
    await fails(()=>read(last.meaningKey,"9223372036854775807"),"wrong_history_changed");
  },60_000);
  it("뜻별 이력도 현재 학생과 관리자 권한으로만 읽는다",async()=>{
    const e=await exam(698);await answer(e,0,1);const current=await state(e.questions[0]),args=[student,current.meaning_key,String(current.last_sequence)];
    const sql="select public.get_student_vocabulary_mistake_episodes_v1($1,$2,$3) value";
    const adminSql="select public.get_admin_vocabulary_mistake_episodes_v1($1,$2,$3) value";
    await fails(()=>asAdmin(sql,args),"permission denied");await fails(()=>service(adminSql,args),"permission denied");
    await fails(async()=>{await db.exec("set local role anon");return rows(sql,args);},"permission denied");
    await fails(()=>service("select private.vocabulary_mistake_episode_rows_v1($1,$2,$3)",[student,[current.meaning_key],current.last_sequence]),"permission denied");
    expect((await asAdmin<{value:unknown}>(adminSql,args))[0].value).toMatchObject({episodeCount:1});
    await rows("update students set status='blocked' where id=$1",[student]);
    expect((await service<{value:unknown}>(sql,args))[0].value).toBeNull();
    expect((await asAdmin<{value:unknown}>(adminSql,args))[0].value).toMatchObject({episodeCount:1});
    await rows("update admin_profiles set is_active=false where user_id=$1",[admin]);
    await fails(()=>asAdmin(adminSql,args),"forbidden");
  });
  it.each([1, 2, 3, 4])("답 API v%i에서도 중복 실패를 한 번만 센다", async version => {
    const e = await exam(30 + version);
    const saved = await answer(e, 0, 1, "initial", version);
    expect(await answer(e, 0, 1, "initial", version)).toEqual(saved);
    expect(await state(e.questions[0])).toMatchObject({ current_wrong_count: 1, lifetime_wrong_count: 1 });
  });
  it("같은 철자의 다른 선택 뜻은 한쪽 정답으로 해결되지 않는다", async () => {
    const a = await exam(40), b = await exam(41, { meaning: "다른 뜻" }), solve = await exam(42);
    await answer(a, 0, 1); await answer(b, 0, 1); await answer(solve, 0, 0);
    expect(await state(a.questions[0])).toMatchObject({ unresolved: false });
    expect(await state(b.questions[0])).toMatchObject({ unresolved: true, current_wrong_count: 1 });
    const identities = await rows<{ value: { wordKey: string; meaningKey: string } }>("select private.quiz_vocabulary_meaning_v1(id) value from quiz_questions where id=any($1::uuid[])", [[a.questions[0], b.questions[0]]]);
    expect(identities[0].value.wordKey).toBe(identities[1].value.wordKey);
    expect(identities[0].value.meaningKey).not.toBe(identities[1].value.meaningKey);
  });
  it("시간초과의 내부 임시 선택을 실제 실패로 세지 않고 원 요청으로 재전송을 확인한다", async () => {
    const e = await exam(50, { timing: "per_question" });
    await db.query("update quiz_attempts set current_question_started_at=clock_timestamp()-interval '10 seconds' where id=$1", [e.attempt]);
    const saved = await answer(e, 0, 3, "initial", 4, true);
    expect(saved.timedOut).toBe(true);
    expect(await state(e.questions[0])).toMatchObject({ unresolved: true, current_wrong_count: 0, current_missed_count: 1 });
    expect(await answer(e, 0, 3, "initial", 4, true)).toEqual(saved);
    await fails(() => answer(e, 0, 1, "initial", 4, true), "question_already_answered");
  });
  it("직접 만료는 미응답만 접수하고 이미 받은 답을 재처리하지 않는다", async () => {
    const e = await exam(60); await answer(e, 0, 1);
    await db.query("update quiz_attempts set deadline_at=clock_timestamp()-interval '1 second' where id=$1", [e.attempt]);
    await service("select public.expire_quiz_attempt($1,$2)", [student, e.attempt]);
    expect(await state(e.questions[0])).toMatchObject({ current_wrong_count: 1, lifetime_wrong_count: 1, current_missed_count: 0 });
    expect(await state(e.questions[1])).toMatchObject({ current_wrong_count: 0, lifetime_wrong_count: 0, current_missed_count: 1 });
    const before = await rows("select * from private.vocabulary_answer_receipts order by server_sequence");
    await service("select public.expire_quiz_attempt($1,$2)", [student, e.attempt]);
    expect(await rows("select * from private.vocabulary_answer_receipts order by server_sequence")).toEqual(before);
    expect(before).toHaveLength(4);
  });
  it("다른 학생과 직접 표/내부 함수 접근을 거절한다", async () => {
    const e = await exam(70);
    await fails(() => service("select public.answer_quiz_question_v4($1,$2,$3,'initial',1::smallint,false)", [other, e.attempt, e.questions[0]]), "attempt_not_found");
    for (const role of ["anon", "authenticated", "service_role"]) {
      await fails(async () => { await db.exec(`set local role ${role}`); return rows("select * from private.vocabulary_answer_receipts"); }, "permission denied");
      await fails(async () => { await db.exec(`set local role ${role}`); return rows("select private.accept_vocabulary_answer_v1($1,$2,$3,'initial',1::smallint,false,'{}')", [student, e.attempt, e.questions[0]]); }, "permission denied");
    }
    expect(await rows("select * from private.vocabulary_answer_receipts")).toEqual([]);
  });
  it("처음부터 맞은 단어는 영수증만 남기고 영구 오답 상태를 만들지 않는다", async () => {
    const e = await exam(80);
    await answer(e, 0, 0);
    expect(await rows("select * from private.student_vocabulary_meaning_states")).toEqual([]);
    expect(await rows("select outcome,episode_id from private.vocabulary_answer_receipts")).toEqual([{ outcome: "correct", episode_id: null }]);
  });
  it("전환 전에 받은 최초 답이 뒤늦게 이력에 기록되어도 누적 횟수에서 빠지지 않는다", async () => {
    const old = await exam(81), current = await exam(82);
    // Invoke the saved pre-M03 grading body as the database owner to represent
    // an already-persisted phase without any new receipt or batch wrong-event.
    await db.query("select private.grade_vocabulary_base($1,$2,$3,'initial',1::smallint)", [student, old.attempt, old.questions[0]]);
    expect(await rows("select * from student_vocab_wrong_events")).toEqual([]);
    await answer(current, 0, 1);
    expect(await state(current.questions[0])).toMatchObject({ lifetime_wrong_count: 2, current_wrong_count: 1, count_quality: "legacy-continuation" });
    for (let i = 1; i < 4; i++) { await ready(old); await answer(old, i, i); }
    expect((await rows("select count(*)::int n from student_vocab_wrong_events where quiz_question_id=$1", [old.questions[0]]))[0]).toEqual({ n: 1 });
    expect(await state(current.questions[0])).toMatchObject({ lifetime_wrong_count: 2, current_wrong_count: 1 });
    await fails(() => answer(old, 0, 1), "question_already_answered");
    expect(await state(current.questions[0])).toMatchObject({ lifetime_wrong_count: 2 });
  });
  it("재시험 마지막 답 이후의 최종 응답과 포인트는 재전송으로 바뀌지 않는다", async () => {
    const e = await exam(83);
    await wrongThenRetry(e);
    for (let i = 1; i < 3; i++) { await ready(e); await answer(e, i, i, "retry"); }
    await ready(e); const saved = await answer(e, 3, 3, "retry");
    await db.exec("set constraints all immediate");
    const before = await rows("select to_jsonb(t) value from student_point_events t order by id");
    const result = await rows("select status,phase,passed,final_score from quiz_attempts where id=$1", [e.attempt]);
    expect(saved).toMatchObject({ completed: true, passed: false });
    expect(result[0]).toMatchObject({ status: "completed", phase: "completed", passed: false, final_score: "75.00" });
    expect(await answer(e, 3, 3, "retry")).toEqual(saved);
    await db.exec("set constraints all immediate");
    expect(await rows("select to_jsonb(t) value from student_point_events t order by id")).toEqual(before);
    expect(await state(e.questions[1])).toMatchObject({ unresolved: false, lifetime_wrong_count: 1 });
  });
  it.each([false, true])("옛 최초 오답의 같은 문항을 새 재시험에서 맞혀도 이전 이력은 유지한다 (옛 시각 없음=%s)", async missingTime => {
    const e = await exam(240);
    for (let n = 0; n < 4; n++) {
      await ready(e);
      await db.query("select private.grade_vocabulary_base($1,$2,$3,'initial',$4::smallint)", [student, e.attempt, e.questions[n], n === 0 ? 1 : n]);
    }
    if (missingTime) await db.query("update quiz_questions set initial_answered_at=null where id=$1", [e.questions[0]]);
    const first = await page({ view: "history" });
    const oldMeaning = first.items[0].meanings[0];
    expect(oldMeaning).toMatchObject({ unresolved: true });
    await service("select public.start_quiz_retry_v2($1,$2)", [student, e.attempt]);
    await ready(e); await answer(e, 0, 0, "retry");
    expect(await state(e.questions[0])).toMatchObject({ unresolved: false, episode_id: expect.any(String), lifetime_wrong_count: 1 });
    const historical = (await rows<{ value: Record<string, unknown> }>("select to_jsonb(s) value from private.vocabulary_meaning_states_at_v1($1,$2) s", [student, first.stateVersion]))[0].value;
    expect(historical).toMatchObject({ unresolved: true, last_wrong_at: expect.any(String), resolved_at: null });
    const after = await page({ view: "history" });
    expect(after.items[0].meanings[0]).toMatchObject({ unresolved: false, resolvedAt: expect.any(String),
      episodes: [{ episodeId: expect.any(String), includesLegacy: true, resolvedAt: expect.any(String), wrongCount: 1 }] });
    expect((await page()).items).toEqual([]);
  });
  it("재시험 없는 초기 완료 보정까지 저장한 결과를 그대로 반환한다", async () => {
    const e = await exam(84, { retry: false });
    await answer(e, 0, 1);
    for (let i = 1; i < 3; i++) { await ready(e); await answer(e, i, i); }
    await ready(e); const saved = await answer(e, 3, 3);
    expect(saved).toMatchObject({ completed: true, needsRetry: false });
    expect(await answer(e, 3, 3)).toEqual(saved);
    await db.exec("set constraints all immediate");
    expect((await rows("select status,phase from quiz_attempts where id=$1", [e.attempt]))[0]).toEqual({ status: "completed", phase: "completed" });
  });
  it("답 API 안에서 전체 만료되는 경우 미제출 사건만 만들고 재전송한다", async () => {
    const e = await exam(85);
    await db.query("update quiz_attempts set started_at=now()-interval '1 minute',deadline_at=now()-interval '1 second' where id=$1", [e.attempt]);
    const saved = await answer(e, 0, 0);
    expect(saved).toMatchObject({ completed: true, expired: true });
    expect(await state(e.questions[0])).toMatchObject({ current_wrong_count: 0, current_missed_count: 1 });
    const before = await rows("select * from private.vocabulary_answer_receipts order by server_sequence");
    expect(await answer(e, 0, 0)).toEqual(saved);
    expect(await rows("select * from private.vocabulary_answer_receipts order by server_sequence")).toEqual(before);
    expect(before).toHaveLength(4);
  });
  it("같은 단어의 두 뜻을 한 카드에 표시하고 한 뜻 정답 뒤 현재/과거를 구별한다", async () => {
    const a = await exam(86), b = await exam(87, { meaning: "다른 뜻" }), solve = await exam(88);
    await answer(a, 0, 1); await answer(b, 0, 1);
    const current = await page();
    expect(current).toMatchObject({ totalCount: 1, summary: { wordCount: 1, currentWrongCount: 2, lifetimeWrongCount: 2 } });
    expect(current.items[0].meanings).toHaveLength(2);
    await answer(solve, 0, 0);
    expect((await page()).items[0].meanings).toHaveLength(1);
    expect((await page()).items[0].lifetimeWrongCount).toBe(2);
    const history = await page({ view: "history" });
    expect(history.items[0].meanings).toHaveLength(2);
    expect(history.items[0].lifetimeWrongCount).toBe(2);
    for (const hidden of ["sourceQuestionId", "sourceAttemptId", "sourcePhase", "correctChoiceIndex", "choices"]) expect(JSON.stringify(history)).not.toContain(hidden);
  });
  it("현재 커서를 상태판·보기·조건에 묶고 해결 뒤 첫 페이지를 다시 읽게 한다", async () => {
    const a = await exam(89), solve = await exam(90);
    for (let i = 0; i < 4; i++) { await ready(a); await answer(a, i, (i + 1) % 4); }
    const first = await page({ pageSize: 2 });
    expect(first.totalCount).toBe(4); expect(first.items).toHaveLength(2);
    const cursor = first.items[1].cursor;
    for (const invalid of [{ ...cursor, stateVersion: null }, { ...cursor, count: null }]) {
      await fails(() => page({ pageSize: 2 }, invalid), "invalid_wrong_history_cursor");
    }
    const second = await page({ pageSize: 2 }, cursor);
    expect(second.items).toHaveLength(2);
    expect(new Set([...first.items, ...second.items].map(x => x.key)).size).toBe(4);
    await fails(() => page({ pageSize: 2, view: "history" }, cursor), "invalid_wrong_history_cursor");
    await answer(solve, 0, 0);
    await fails(() => page({ pageSize: 2 }, cursor), "wrong_history_changed");
    expect((await page()).totalCount).toBe(3);
    expect((await page({ view: "history" })).totalCount).toBe(4);
  });
  it("조회는 표를 변경하지 않고 정상0건·필터오류·역할 권한을 구별한다", async () => {
    const a = await exam(91); await answer(a, 0, 1);
    const snapshot = () => rows("select (select jsonb_agg(to_jsonb(s) order by meaning_key) from private.student_vocabulary_meaning_states s) states,(select jsonb_agg(to_jsonb(r) order by server_sequence) from private.vocabulary_answer_receipts r) receipts");
    const before = await snapshot();
    expect(await page({ query: "찾을 수 없는 단어" })).toMatchObject({ items: [], totalCount: 0 });
    await page(); await page({ view: "history" });
    expect(await snapshot()).toEqual(before);
    await fails(() => page({ view: "invalid" }), "invalid_wrong_history_page");
    for (const role of ["anon", "authenticated"]) {
      await fails(async () => { await db.exec(`set local role ${role}`); return rows("select public.get_student_vocabulary_mistake_page_v1($1)", [student]); }, "permission denied");
    }
    await fails(() => service("select public.get_admin_vocabulary_mistake_page_v1($1)", [student]), "permission denied");
  });
  it("시험 상태가 같아도 자료명이나 학생이 바뀌면 표시 자료판이 달라진다", async () => {
    const a=await exam(190);await answer(a,0,1);
    const first=await page();
    await rows('update public.vocab_datasets set title=$1 where id=$2',['이름을 바꾼 가짜 책',dataset]);
    const changed=await page();
    expect(changed.stateVersion).toBe(first.stateVersion);expect(changed.sourceVersion).not.toBe(first.sourceVersion);
    expect(changed.items[0].sourceVersion).toBe(changed.sourceVersion);
    await fails(()=>page({},first.items[0].cursor),'wrong_history_changed');
    // An empty page also carries an owner-bound display snapshot.
    const ownEmpty=(await service<{value:MistakePage}>('select public.get_student_vocabulary_mistake_page_v1($1,$2) value',[student,{query:'no such word'}]))[0].value;
    const otherEmpty=(await service<{value:MistakePage}>('select public.get_student_vocabulary_mistake_page_v1($1,$2) value',[other,{}]))[0].value;
    expect(ownEmpty.sourceVersion).not.toBe(otherEmpty.sourceVersion);
  });
  it("미해결 과거 구간의 첫 새 답은 공개된 구간을 이어받고 이미 해결된 날짜는 보존한다", async () => {
    const old = await exam(92), next = await exam(93), solve = await exam(94), solveAgain = await exam(95);
    await db.query("select private.grade_vocabulary_base($1,$2,$3,'initial',1::smallint)", [student, old.attempt, old.questions[0]]);
    const legacy = (await rows<{ episode_id: string }>("select episode_id from private.current_vocabulary_meaning_states_v1($1)", [student]))[0];
    await answer(next, 0, 1);
    expect((await state(next.questions[0])).episode_id).toBe(legacy.episode_id);
    await answer(solve, 0, 0);
    const date = () => rows("select resolved_at from private.student_vocabulary_meaning_states where student_id=$1", [student]);
    const before = await date(); await answer(solveAgain, 0, 0); expect(await date()).toEqual(before);
  });
  it("옛 오답 근거는 최초와 재시험을 섞지 않고 보존된NULL과 실제false를 구별한다",async()=>{
    const e=await exam(280);
    await rows("select private.grade_vocabulary_base($1,$2,$3,'initial',1::smallint)",[student,e.attempt,e.questions[0]]);
    const evidence=async(question:string,phase:string,owner=student)=>(await rows<{value:Record<string,unknown>|null}>(
      'select private.vocabulary_legacy_failure_evidence_v1($1,$2,$3) value',[owner,question,phase]))[0].value;
    expect(await evidence(e.questions[0],'initial')).toMatchObject({evidenceKind:'phase_false',phaseIsCorrect:false});
    expect(await evidence(e.questions[0],'retry')).toBeNull();
    expect(await evidence(e.questions[0],'initial',other)).toBeNull();
    await rows("update quiz_questions set retry_is_correct=false,retry_answered_at=clock_timestamp() where id=$1",[e.questions[0]]);
    await rows('select private.preserve_vocabulary_legacy_questions_v1($1)',[e.attempt]);
    await rows("update quiz_questions set retry_is_correct=true where id=$1",[e.questions[0]]);
    expect(await evidence(e.questions[0],'retry')).toMatchObject({phaseIsCorrect:false,baselinePresent:true,baselineRetryIsCorrect:false});
    await rows('insert into private.vocabulary_legacy_question_baselines(quiz_question_id,retry_is_correct,initial_wrong_at) values($1,null,clock_timestamp())',[e.questions[1]]);
    await rows("update quiz_questions set retry_is_correct=false,retry_answered_at=clock_timestamp() where id=$1",[e.questions[1]]);
    expect(await evidence(e.questions[1],'retry')).toBeNull();
    await fails(async()=>{await db.exec('set local role service_role');return rows('select private.vocabulary_legacy_failure_evidence_v1($1,$2,$3)',[student,e.questions[0],'retry']);},'permission denied');
  });
  it("해결 이력도 같은 실패 사건의 문항과 단계를 반환한다", async () => {
    const wrong = await exam(96), solve = await exam(97);
    await wrongThenRetry(wrong); await answer(solve, 0, 0);
    const result = (await rows<{ value: { items: { meanings: { sourceQuestionId: string; sourcePhase: string }[] }[] } }>(
      "select private.vocabulary_mistake_page_v1($1,'{\"view\":\"history\"}',null,true) value", [student]))[0].value;
    expect(result.items.flatMap(x => x.meanings).find(x => x.sourceQuestionId === wrong.questions[0])).toMatchObject({ sourcePhase: "retry" });
    expect(JSON.stringify(result)).not.toContain(solve.questions[0]);
  });
  it.each(["definition", "example"] as const)("%s 시험 내용과 한국어 뜻은 다른 필드로 보존한다", async testedField => {
    const e = await exam(98, { testedField }); await answer(e, 0, 1);
    const result = await page();
    expect(result.items[0]).toMatchObject({ primaryMeaning: "가짜 뜻1" });
    expect(result.items[0].meanings[0]).toMatchObject({ testedField });
  });
  it("A/B 자료에서 별도로 승인한 같은 뜻은 카드 하나·4회·출처 둘로 조회된다", async () => {
    const second = id(190), secondUnit = id(191);
    await db.query(`insert into vocab_datasets(id,dataset_key,title,source_label,source_sha256,row_count,status,imported_by)
      values($1,'m03-fake-second','가짜 두번째 자료','가짜',repeat('C',64),4,'ready',$2)`, [second, admin]);
    await db.query(`insert into vocab_units(id,dataset_id,unit_label,normalized_label,unit_kind,unit_number,sort_index,entry_count)
      values($1,$2,'DAY 1','day 1','day',1,1,4)`, [secondUnit, second]);
    await db.query(`insert into vocab_entries(dataset_id,source_row,headword,headword_normalized,meanings,primary_meaning,row_sha256,unit_id,position_in_unit,entry_type)
      select $1,source_row,headword,headword_normalized,meanings,primary_meaning,repeat('D',63)||source_row::text,$2,position_in_unit,entry_type from vocab_entries where dataset_id=$3`, [second, secondUnit, dataset]);
    await seedRelease(dataset, id(192)); await seedRelease(second, id(193));
    const a = await exam(99, { release: id(192) }), b = await exam(100, { dataset: second, unit: secondUnit, release: id(193) });
    const identity = async (q: string) => (await rows<{ value: Record<string, unknown> }>("select private.quiz_vocabulary_meaning_v1($1) value", [q]))[0].value;
    expect(await identity(a.questions[0])).toMatchObject({ identityKind: "reviewed-meaning-v1", wordKey: "dictionary:word:m03-shared-1" });
    expect((await identity(a.questions[0])).meaningKey).toBe((await identity(b.questions[0])).meaningKey);
    expect((await identity(a.questions[1])).meaningKey).not.toBe((await identity(b.questions[1])).meaningKey);
    await wrongThenRetry(a); await wrongThenRetry(b);
    const result = await page({ query: "fakeword1" });
    expect(result).toMatchObject({ totalCount: 1 });
    expect(result.items[0]).toMatchObject({ currentWrongCount: 4, meanings: [{ currentWrongCount: 4, sources: expect.arrayContaining([
      expect.objectContaining({ datasetId: dataset, currentWrongCount: 2 }), expect.objectContaining({ datasetId: second, currentWrongCount: 2 }),
    ]) }] });
    expect((await page({ datasetId: dataset, query: "fakeword1" })).items[0].currentWrongCount).toBe(4);
    expect((await page({ datasetId: second, query: "fakeword1" })).items[0].currentWrongCount).toBe(4);
  });
  it("새 승인은 예전에 확정한 같은 본문의 미승인 뜻을 바꾸지 않는다", async () => {
    await seedRelease(dataset, id(194), false);
    const old = await exam(101, { release: id(194) });
    const identity = async (q: string) => (await rows<{ value: Record<string, unknown> }>("select private.quiz_vocabulary_meaning_v1($1) value", [q]))[0].value;
    const before = await identity(old.questions[0]); await approveRelease(dataset, id(194));
    const next = await exam(102, { release: id(194) });
    expect(await identity(old.questions[0])).toEqual(before);
    expect(await identity(next.questions[0])).toMatchObject({ identityKind: "reviewed-meaning-v1" });
    expect((await identity(next.questions[0])).meaningKey).not.toBe(before.meaningKey);
  });
  it("같은 뜻은 대기 하나, 다른 뜻은 대기 둘이며 정답은 그 뜻만 정리한다", async () => {
    const a = await exam(103), duplicate = await exam(104), otherMeaning = await exam(105, { meaning: "또 다른 뜻" }), solve = await exam(106);
    await answer(a, 0, 1); await answer(duplicate, 0, 1); await answer(otherMeaning, 0, 1);
    const first = await queue([a.questions[0]]);
    expect(await queue([duplicate.questions[0]])).toEqual(first);
    const second = await queue([otherMeaning.questions[0]]);
    expect(second[0]).not.toBe(first[0]);
    expect((await rows("select id from student_vocab_review_queue where status='pending'")).length).toBe(2);
    await answer(solve, 0, 0);
    expect((await rows("select id,status from student_vocab_review_queue order by id")).filter(x => x.status === "pending")).toEqual([{ id: second[0], status: "pending" }]);
    expect((await rows("select reason_level from student_vocab_review_queue where id=$1", first))[0]).toEqual({ reason_level: 1 });
  });
  it("관리자 목록은 뜻과 구간별 대기·배정을 보이고 검색 밖의 활성 초안 취소도 보존한다", async () => {
    const a=await exam(250),different=await exam(251,{meaning:'다른 가짜 뜻'}),assigned=await exam(252),solve=await exam(253),again=await exam(254);
    await answer(a,0,1);await answer(different,0,1);
    const read=async(filters:Record<string,unknown>={})=>(await asAdmin<{value:AdminMistakePage}>(
      'select public.get_admin_vocabulary_mistake_page_v1($1,$2) value',[student,filters]))[0].value;
    const meaning=(await state(a.questions[0])).meaning_key;
    const first=await read();expect(first.items[0].meanings.map(item=>item.scheduling)).toEqual(['available','available']);
    const [queueId]=await queue([a.questions[0]]),draftId=id(9150);
    await rows(`insert into student_vocab_review_assignment_drafts(id,student_id,dataset_id,created_by) values($1,$2,$3,$4)`,[draftId,student,dataset,admin]);
    await rows('update student_vocab_review_queue set reserved_review_draft_id=$2,reserved_at=clock_timestamp() where id=$1',[queueId,draftId]);
    const reserved=await read();
    expect(reserved.items[0].meanings.find(item=>item.meaningKey===meaning)).toMatchObject({scheduling:'queued',queueId,reviewDraftId:draftId,activeAssignment:null,isCurrentEpisode:true});
    const empty=await read({query:'no such word'});expect(empty.items).toEqual([]);
    expect(empty.reviewDrafts).toEqual([{draftId,datasetId:dataset,questionCount:1}]);
    await rows("update student_vocab_review_assignment_drafts set created_at=clock_timestamp()-interval '2 hours',expires_at=clock_timestamp()-interval '1 hour' where id=$1",[draftId]);
    const expired=await read();expect(expired.reviewDrafts).toEqual([]);
    expect(expired.items[0].meanings.find(item=>item.meaningKey===meaning)).toMatchObject({scheduling:'queued',reviewDraftId:null});
    await rows('update student_vocab_review_queue set reserved_review_draft_id=null,reserved_at=null where id=$1',[queueId]);
    await rows('select private.link_pending_review_targets_v2($1,$2,$3)',[assigned.assignment,[student],[queueId]]);
    const linked=await read();expect(linked.items[0].meanings.find(item=>item.meaningKey===meaning)).toMatchObject({
      scheduling:'assigned',queueId,activeAssignment:{assignmentId:assigned.assignment}});
    expect(linked.items[0].meanings.find(item=>item.meaningKey!==meaning)?.scheduling).toBe('available');
    await answer(solve,0,0);await answer(again,0,1);await queue([again.questions[0]]);
    const past=await read({view:'history',upperVersion:linked.stateVersion});
    expect(past.items[0].meanings.find(item=>item.meaningKey===meaning)).toMatchObject({unresolved:true,scheduling:'none',isCurrentEpisode:false,queueId:null,activeAssignment:null});
    expect(past.schedulingBasis).toBe('current');
    const current=await read();expect(current.items[0].meanings.find(item=>item.meaningKey===meaning)).toMatchObject({scheduling:'queued',isCurrentEpisode:true});
  });
  it("오래된 선택·다른 학생·정답 단계·이전 구간 문항은 대기에 넣지 않는다", async () => {
    const a = await exam(107), solve = await exam(108), again = await exam(109);
    await answer(a, 0, 1); const old = await targets([a.questions[0]]);
    await answer(solve, 0, 0); await answer(again, 0, 1);
    await fails(() => asAdmin("select public.queue_student_vocabulary_mistakes_v1($1,$2)", [student, JSON.stringify(old)]), "wrong_history_changed");
    await fails(() => asAdmin("select public.queue_student_vocab_review_words($1,$2)", [student, [a.questions[0]]]), "wrong_history_changed");
    const latest = await targets([again.questions[0]]);
    await fails(() => asAdmin("select public.queue_student_vocabulary_mistakes_v1($1,$2)", [other, JSON.stringify(latest)]), "wrong_history_changed");
    await fails(() => asAdmin("select public.queue_student_vocabulary_mistakes_v1($1,$2)", [student, JSON.stringify([{ ...latest[0], sourcePhase: "retry" }])]), "review_question_not_available");
    expect(await rows("select id from student_vocab_review_queue")).toEqual([]);
  });
  it("뜻별 대기는 선택한 최초·재시험 단계를 보존하며 같은 구간 재선택은 기존 대기를 반환한다",async()=>{
    const e=await exam(270);await wrongThenRetry(e);
    const selected=await targets([e.questions[0]]);
    const initial=selected.find(item=>item.sourcePhase==='initial')!,retry=selected.find(item=>item.sourcePhase==='retry')!;
    const enqueue=async(target:Record<string,unknown>)=>(await asAdmin<{value:string[]}>(
      'select public.queue_student_vocabulary_mistakes_v1($1,$2) value',[student,[target]]))[0].value;
    const first=await enqueue(initial);
    expect((await rows('select source_phase_snapshot from student_vocab_review_queue where id=$1',[first[0]]))[0]).toEqual({source_phase_snapshot:'initial'});
    expect(await enqueue(retry)).toEqual(first);
    expect((await rows('select source_phase_snapshot from student_vocab_review_queue where id=$1',[first[0]]))[0]).toEqual({source_phase_snapshot:'initial'});
  });
  it("해결된 구간의 진행 배정은 보존하고 새 오답 구간의 대기를 허용한다", async () => {
    const a = await exam(110), assigned = await exam(111), solve = await exam(112), again = await exam(113);
    await answer(a, 0, 1); const [queueId] = await queue([a.questions[0]]);
    const assignedQuestion = (await rows<{ assignment_question_id: string }>("select assignment_question_id from quiz_questions where id=$1", [assigned.questions[0]]))[0].assignment_question_id;
    await db.query(`insert into assignment_review_targets(assignment_id,student_id,review_queue_id,assignment_question_id,dataset_id,vocab_entry_id)
      select $1,$2,$3,id,dataset_id,vocab_entry_id from assignment_questions where id=$4`, [assigned.assignment, student, queueId, assignedQuestion]);
    await db.query("update student_vocab_review_queue set status='consumed',consumed_at=clock_timestamp(),consumed_assignment_id=$2 where id=$1", [queueId, assigned.assignment]);
    const before = await rows("select to_jsonb(q) value from quiz_questions q where attempt_id=$1 order by order_index", [assigned.attempt]);
    await answer(solve, 0, 0); await answer(again, 0, 1);
    const next = await queue([again.questions[0]]); expect(next[0]).not.toBe(queueId);
    expect(await rows("select to_jsonb(q) value from quiz_questions q where attempt_id=$1 order by order_index", [assigned.attempt])).toEqual(before);
    expect((await rows("select release_reason from assignment_review_targets where review_queue_id=$1", [queueId]))[0]).toEqual({ release_reason: "resolved" });
    expect((await rows("select status from quiz_attempts where id=$1", [assigned.attempt]))[0]).toEqual({ status: "in_progress" });
  });
  it.each(["complete", "expire"] as const)("앞선 오답 대상은 %s 종료 뒤 다시 대기하고 종료 재요청은 바꾸지 않는다", async end => {
    const wrong = await exam(114), assigned = await exam(115, { retry: false });
    await answer(wrong, 0, 1); const [queueId] = await queue([wrong.questions[0]]);
    await db.query("select private.link_pending_review_targets_v2($1,$2,$3)", [assigned.assignment, [student], [queueId]]);
    await db.query("update student_vocab_review_queue set status='consumed',consumed_at=clock_timestamp(),consumed_assignment_id=$2 where id=$1", [queueId, assigned.assignment]);
    await answer(assigned, 0, 1);
    if (end === "complete") {
      for (let n = 1; n < 4; n++) { await ready(assigned); await answer(assigned, n, n); }
    } else {
      await db.query("update quiz_attempts set deadline_at=clock_timestamp()-interval '1 second' where id=$1", [assigned.attempt]);
      await service("select public.expire_quiz_attempt($1,$2)", [student, assigned.attempt]);
    }
    expect((await rows("select status from student_vocab_review_queue where id=$1", [queueId]))[0]).toEqual({ status: "pending" });
    expect((await rows("select release_reason from assignment_review_targets where review_queue_id=$1", [queueId]))[0]).toEqual({ release_reason: "completed_unresolved" });
    const before = await rows("select to_jsonb(q) value from student_vocab_review_queue q where id=$1", [queueId]);
    if (end === "complete") await answer(assigned, 3, 3);
    else await service("select public.expire_quiz_attempt($1,$2)", [student, assigned.attempt]);
    expect(await rows("select to_jsonb(q) value from student_vocab_review_queue q where id=$1", [queueId])).toEqual(before);
  });
  it("문제지는 같은 단어의 두 뜻을 공유본문 참조로 보관하고 해결 뒤 같은 요청도 재사용한다",async()=>{
    const a=await exam(170,{retry:false}),b=await exam(171,{retry:false,meaning:"별개의 뜻"}),solve=await exam(172);
    for(const e of [a,b]) for(let n=0;n<4;n++){await ready(e);await answer(e,n,n===0?1:n);}
    const selected=await targets([a.questions[0],b.questions[0]]);
    const before=await officialSnapshot(), materials=await rows("select count(*) from private.vocabulary_question_content_versions");
    const create=async (input:unknown)=> (await asAdmin<{request_id:string;item_count:number;content_sha256:string;reused:boolean}>(
      "select * from public.create_wrong_word_worksheet_request_v2($1,$2)",[student,JSON.stringify(input)]))[0];
    const saved=await create(selected);
    expect(saved).toMatchObject({item_count:2,reused:false});
    expect(await create([...selected].reverse())).toEqual({...saved,reused:true});
    const exported=(await asAdmin<{value:{items:Array<Record<string,unknown>>;schema_version:string}}>(
      "select public.export_wrong_word_worksheet_request_v1($1) value",[saved.request_id]))[0].value;
    expect(exported.schema_version).toBe("wrong-word-worksheet-request-v2");
    expect(exported.items.map(item=>item.selectedText).sort()).toEqual(["가짜 뜻1","별개의 뜻"].sort());
    expect(exported.items.every(item=>item.currentWrongCount===1&&item.lifetimeWrongCount===1&&item.countQuality==="exact")).toBe(true);
    const records=await rows("select to_jsonb(i) value from private.worksheet_mistake_items i where request_id=$1",[saved.request_id]);
    expect(JSON.stringify(records)).not.toContain("가짜 뜻"); expect(JSON.stringify(records)).not.toContain("choices");
    expect(await rows("select count(*) from private.vocabulary_question_content_versions")).toEqual(materials);
    expect(await officialSnapshot()).toEqual(before);
    await answer(solve,0,0);
    expect(await create(selected.map(target=>({...target,episodeId:String(target.episodeId).toUpperCase()})))).toEqual({...saved,reused:true});
    await db.query("update vocab_entries set primary_meaning='나중에 수정된 뜻',meanings=array['나중에 수정된 뜻'] where dataset_id=$1",[dataset]);
    expect((await asAdmin<{value:unknown}>("select public.export_wrong_word_worksheet_request_v1($1) value",[saved.request_id]))[0].value).toEqual(exported);
    await fails(()=>asAdmin("select * from public.create_wrong_word_worksheet_request_v2($1,$2)",[other,JSON.stringify(selected)]),"review_question_not_available");
    await fails(()=>service("select * from private.worksheet_mistake_items"),"permission denied");
  });
  it.each(["definition","example"] as const)("%s 문제지 선택은 원래 시험한 값을 보관하고 기본 뜻으로 바꾸지 않는다",async testedField=>{
    const e=await exam(173,{retry:false,testedField});
    for(let n=0;n<4;n++){await ready(e);await answer(e,n,n===0?1:n);}
    const selected=await targets([e.questions[0]]);
    const saved=(await asAdmin<{request_id:string}>("select * from public.create_wrong_word_worksheet_request_v2($1,$2)",[student,JSON.stringify(selected)]))[0];
    const item=(await asAdmin<{value:Record<string,unknown>}>("select public.export_wrong_word_worksheet_request_v1($1)->'items'->0 value",[saved.request_id]))[0].value;
    expect(item).toMatchObject({testedField,selectedText:testedField==="definition"?"an English definition":"This is an example with _____.",
      primaryMeaning:"가짜 뜻1",generation_status:"needs_dictionary_link",currentWrongCount:1});
    await fails(()=>db.query("update private.worksheet_mistake_items set source_phase='retry' where request_id=$1",[saved.request_id]),"immutable");
  });
  it("문제지 재시험 단계와 새로운 구간을 구분하고 오래된 신규 요청을 거절한다",async()=>{
    const e=await exam(174);await wrongThenRetry(e);
    for(let n=1;n<4;n++){await ready(e);await answer(e,n,n,"retry");}
    const chosen=(await targets([e.questions[0]])).filter(item=>item.sourcePhase==="retry");
    const saved=(await asAdmin<{request_id:string}>("select * from public.create_wrong_word_worksheet_request_v2($1,$2)",[student,JSON.stringify(chosen)]))[0];
    expect((await asAdmin<{value:unknown}>("select public.export_wrong_word_worksheet_request_v1($1)->'items'->0 value",[saved.request_id]))[0].value)
      .toMatchObject({sourcePhase:"retry",sourceQuestionId:e.questions[0],currentWrongCount:2});
    const solve=await exam(175),next=await exam(176,{retry:false});await answer(solve,0,0);
    for(let n=0;n<4;n++){await ready(next);await answer(next,n,n===0?1:n);}
    const again=(await asAdmin<{request_id:string;reused:boolean}>("select * from public.create_wrong_word_worksheet_request_v2($1,$2)",[student,JSON.stringify(await targets([next.questions[0]]))]))[0];
    expect(again.reused).toBe(false);expect(again.request_id).not.toBe(saved.request_id);
    expect((await asAdmin<{value:number}>("select public.export_wrong_word_worksheet_request_v1($1)->'items'->0->'currentWrongCount' value",[again.request_id]))[0].value).toBe(1);
  });

  async function notebookSetup() {
    await rows("update students set school_name='가짜학교',grade_label='고1' where id=any($1::uuid[])", [[student, other]]);
    await rows("insert into vocab_dataset_catalog(dataset_id,display_name,catalog_group,material_kind,grade_code,is_assignable) values($1,'가짜 오답 자료','high','wordbook','g10',true) on conflict(dataset_id) do update set is_assignable=true", [dataset]);
  }
  async function completeWrong(e: FakeExam, wrong = [0]) {
    for (let n = 0; n < 4; n++) { await ready(e); await answer(e, n, wrong.includes(n) ? (n + 1) % 4 : n); }
  }
  async function notebookInput(qs: string[], phase: "initial" | "retry" = "initial") {
    const selection = { mode: "mistake_targets", targets: (await targets(qs)).filter(target => target.sourcePhase === phase) };
    const source = mistakePracticeSourceSchema.parse((await service<{ value: unknown }>(
      "select public.prepare_notebook_assignment_source_v2($1,$2,$3) value", [admin, student, selection]))[0].value);
    const voice = { displayKo: null, variantId: null, audioUrl: null, available: false };
    const questions = source.words.map((word, bankIndex) => ({ ...word.frozenQuestion, wordKey: word.wordKey, meaningKey: word.meaningKey,
      episodeId: word.episodeId, sourceQuestionId: word.sourceQuestionId, sourcePhase: word.sourcePhase, sourceContentHash: word.sourceContentHash,
      pronunciation: voice, choicePronunciations: [voice, voice, voice, voice], choiceSources: [] as {entryId:number;headword:string;primaryMeaning:string}[], bankIndex }));
    return { studentId: student, selection, sourceHash: source.sourceHash, audienceMode: "single", gradeConfirmed: false,
      settings: { questionCount: questions.length, englishToKoreanRatio: questions.filter(q => q.direction === "english_to_korean").length * 100 / questions.length,
        timingMode: "none", timeLimitSeconds: null, questionTimeLimitSeconds: null, passingScore: 80, retryEnabled: false, retryPassingScore: null }, questions,
      banks: questions.map(q => ({ index: q.bankIndex, questionCount: 1, englishToKoreanRatio: q.direction === "english_to_korean" ? 100 : 0, timeLimitSeconds: null })) };
  }
  async function saveNotebook(batch: Awaited<ReturnType<typeof notebookInput>>, key: string, hash = "a".repeat(64)) {
    try {
      return (await service<{ value: { studentId: string; assignmentId: string; questionCount: number }[] }>(
        "select public.create_notebook_assignments_v2($1,$2,$3,$4) value", [admin, key, hash, JSON.stringify([batch])]))[0].value;
    } catch (error) {
      const failure = error as Error & { where?: string; detail?: string };
      throw new Error([failure.message, failure.detail, failure.where].filter(Boolean).join("\n"), { cause: error });
    }
  }
  it("개인 오답을 10번 다시 배정해도 원문 제한·뜻·공유본문을 그대로 이어간다",async()=>{
    await notebookSetup();const originalMeaning="당시 고정한 뜻";
    let previous=await exam(330,{meaning:originalMeaning,retry:false});await completeWrong(previous);
    const originalQuestion=previous.questions[0];
    const root=(await rows<{content_version_id:string}>("select content_version_id from quiz_questions where id=$1",[originalQuestion]))[0];
    const identity=(await rows<{value:unknown}>("select private.quiz_vocabulary_meaning_v1($1) value",[originalQuestion]))[0].value;
    for(let generation=1;generation<=10;generation++){
      const batch=await notebookInput([previous.questions[0]]);
      const source=mistakePracticeSourceSchema.parse((await service<{value:unknown}>("select public.prepare_notebook_assignment_source_v2($1,$2,$3) value",[admin,student,batch.selection]))[0].value);
      expect(source.words[0].frozenOnly).toBe(true);
      if(generation===2){
        const copied={...source,words:source.words.map(word=>({...word,frozenOnly:false}))};
        const settings:PracticeSettings={questionCount:1,englishToKoreanRatio:100,timingMode:"none",timeLimitSeconds:null,questionTimeLimitSeconds:null};
        const generated=frozenPracticeQuestions(copied,settings);expect(generated[0].choiceSources).toHaveLength(4);
        const before=await rows("select (select count(*) from assignments) banks,(select count(*) from private.notebook_question_origins_v2) origins,(select count(*) from private.vocabulary_question_content_versions) bodies");
        await fails(()=>saveNotebook({...batch,questions:generated.map(question=>({...question,bankIndex:0}))},id(9602)),"invalid_practice_questions");
        expect(await rows("select (select count(*) from assignments) banks,(select count(*) from private.notebook_question_origins_v2) origins,(select count(*) from private.vocabulary_question_content_versions) bodies")).toEqual(before);
      }
      const saved=await saveNotebook(batch,id(9500+generation)),assignment=saved[0].assignmentId;
      const bank=(await rows(`select o.source_frozen_only,o.body_mode,o.source_question_id,o.identity,
        c.payload->>'sourceContentVersionId' parent_id,
        coalesce(parent.payload->>'schemaVersion'='notebook-shared-body-ref-v1',false) parent_is_reference,
        q.prompt is null and q.choices is null compact,c.payload ? 'prompt' or c.payload ? 'choices' duplicated
        from assignment_questions q join private.notebook_question_origins_v2 o on o.assignment_question_id=q.id
        join private.vocabulary_question_content_versions c on c.id=q.content_version_id
        join private.vocabulary_question_content_versions parent on parent.id=(c.payload->>'sourceContentVersionId')::uuid where q.assignment_id=$1`,[assignment]))[0];
      expect(bank).toEqual({source_frozen_only:true,body_mode:"frozen",source_question_id:previous.questions[0],identity,
        parent_id:root.content_version_id,parent_is_reference:false,compact:true,duplicated:false});
      const attempt=(await service<{value:string}>("select public.create_quiz_attempt_from_bank($1,$2) value",[student,assignment]))[0].value;
      const question=(await rows<{id:string;correct_choice_index:number}>("select id,correct_choice_index from quiz_questions where attempt_id=$1",[attempt]))[0];
      previous={assignment,attempt,questions:[question.id]};await ready(previous);await answer(previous,0,(question.correct_choice_index+1)%4);
      expect((await state(question.id)).current_wrong_count).toBe(generation+1);
      if(generation===1){
        await rows("update vocab_entries set primary_meaning=$2,meanings=array[$2]::text[],row_sha256=repeat('E',64) where dataset_id=$1 and source_row=1",[dataset,originalMeaning]);
        await rows(`insert into vocab_entry_quiz_eligibility(vocab_entry_id,dataset_id,quiz_mode,status,input_content_hash,rule_version,evaluated_at_utc)
          select id,dataset_id,'book_meaning_en_to_ko','eligible',row_sha256,'fixture',clock_timestamp() from vocab_entries where dataset_id=$1`,[dataset]);
      }
    }
  },60_000);
  it("개인 오답 배정의 삭제 사유를 저장하고 원 문항과 접수는 보존한다",async()=>{
    await notebookSetup();const e=await exam(390,{retry:false});await completeWrong(e);
    const saved=await saveNotebook(await notebookInput([e.questions[0]]),id(9390)),aid=saved[0].assignmentId;
    const before=await rows("select to_jsonb(q) value from assignment_questions q where assignment_id=$1 order by id",[aid]);
    const receipts=await rows("select to_jsonb(r) value from private.vocabulary_answer_receipts r where student_id=$1 order by server_sequence",[student]);
    await asAdmin("select public.delete_assignment_v2($1,'가짜 오답 배정 종료')",[aid]);
    expect(await rows("select status,deletion_reason,deleted_at is not null deleted from assignments where id=$1",[aid])).toEqual([{status:"closed",deletion_reason:"가짜 오답 배정 종료",deleted:true}]);
    expect(await rows("select to_jsonb(q) value from assignment_questions q where assignment_id=$1 order by id",[aid])).toEqual(before);
    expect(await rows("select to_jsonb(r) value from private.vocabulary_answer_receipts r where student_id=$1 order by server_sequence",[student])).toEqual(receipts);
  });
  it.each(["primary_meaning", "definition", "example"] as const)("%s 온라인 오답은 원문을 공용 참조하고 동일 뜻을 유지한다", async field => {
    await notebookSetup();
    const e = await exam(180, { retry: false, ...(field === "primary_meaning" ? {} : { testedField: field }) });
    await completeWrong(e); const input = await notebookInput([e.questions[0]]);
    const before = (await rows<{ count: number }>("select count(*)::integer count from private.vocabulary_question_content_versions"))[0].count;
    const saved = await saveNotebook(input, id(9180));
    const bank = (await rows<{ id: string; content_version_id: string; compact: boolean; payload: Record<string, unknown> }>(
      "select q.id,q.content_version_id,q.prompt is null and q.choices is null compact,c.payload from assignment_questions q join private.vocabulary_question_content_versions c on c.id=q.content_version_id where q.assignment_id=$1", [saved[0].assignmentId]))[0];
    expect(bank.compact).toBe(true); expect(bank.payload.schemaVersion).toBe("notebook-shared-body-ref-v1");
    expect(bank.payload).not.toHaveProperty("prompt"); expect(bank.payload).not.toHaveProperty("choices");
    expect(JSON.stringify(bank.payload)).not.toContain(student); expect(JSON.stringify(bank.payload)).not.toContain(e.questions[0]);
    const restored = (await rows<{ prompt: string; choices: string[]; direction: string; correct_choice_index: number }>(
      "select prompt,choices,direction,correct_choice_index from private.assignment_question_contents_v1 where id=$1", [bank.id]))[0];
    expect(restored).toEqual((await rows("select prompt,choices,direction,correct_choice_index from private.quiz_question_contents_v1 where id=$1", [e.questions[0]]))[0]);
    expect(await rows("select private.assignment_vocabulary_meaning_v1($1) value", [bank.id])).toEqual(await rows("select private.quiz_vocabulary_meaning_v1($1) value", [e.questions[0]]));
    expect((await rows<{ count: number }>("select count(*)::integer count from private.vocabulary_question_content_versions"))[0].count).toBe(before + 1);
    expect(await saveNotebook(input, id(9180))).toEqual(saved);
    await fails(()=>rows("update private.notebook_assignment_requests set result='[]' where request_key=$1",[id(9180)]),"immutable");
    await fails(()=>rows("delete from private.notebook_assignment_requests where request_key=$1",[id(9180)]),"immutable");
    expect((await rows("select scheduling from private.vocabulary_meaning_scheduling_v1($1,$2)", [student, [input.questions[0].meaningKey]]))).toEqual([{ scheduling: "assigned" }]);
    await rows("set constraints all immediate");
  });
  it("같은 단어의 두 뜻을 각각 배정하고 한 뜻만 정답으로 해결한다", async () => {
    await notebookSetup();
    const a = await exam(181, { retry: false }), b = await exam(182, { retry: false, meaning: "별개의 뜻" });
    await completeWrong(a); await completeWrong(b);
    const saved = await saveNotebook(await notebookInput([a.questions[0], b.questions[0]]), id(9181));
    expect(saved).toHaveLength(2); expect(saved.map(row => row.questionCount)).toEqual([1, 1]);
    const links = await rows<{ aid: string; meaning_key: string; episode_id: string }>("select q.assignment_id aid,o.meaning_key,o.episode_id from assignment_questions q join private.notebook_question_origins_v2 o on o.assignment_question_id=q.id where q.assignment_id=any($1::uuid[])", [saved.map(row => row.assignmentId)]);
    expect(new Set(links.map(row => row.meaning_key)).size).toBe(2);
    const attempt = (await service<{ value: string }>("select public.create_quiz_attempt_from_bank($1,$2) value", [student, saved[0].assignmentId]))[0].value;
    const question = (await rows<{ id: string; correct_choice_index: number }>("select id,correct_choice_index from quiz_questions where attempt_id=$1", [attempt]))[0];
    const beforePoints = await rows("select to_jsonb(p) value from student_point_events p order by id");
    await ready({ attempt, assignment: saved[0].assignmentId, questions: [question.id] });
    await service("select public.answer_quiz_question_v4($1,$2,$3,'initial',$4::smallint,false)", [student, attempt, question.id, question.correct_choice_index]);
    expect(await rows("select unresolved from private.student_vocabulary_meaning_states where student_id=$1 and meaning_key=any($2::text[]) order by unresolved", [student, links.map(row => row.meaning_key)])).toEqual([{ unresolved: false }, { unresolved: true }]);
    expect(await rows("select to_jsonb(p) value from student_point_events p order by id")).toEqual(beforePoints);
  });
  it("해결 뒤 재전송은 기존 배정을 반환하고 새 구간은 공용 본문까지 재사용한다", async () => {
    await notebookSetup(); const a = await exam(183, { retry: false }), solve = await exam(184), next = await exam(185, { retry: false });
    await completeWrong(a); const batch = await notebookInput([a.questions[0]]), saved = await saveNotebook(batch, id(9183));
    await answer(solve, 0, 0);
    expect(await saveNotebook(batch, id(9183))).toEqual(saved);
    await fails(() => saveNotebook(batch, id(9183), "b".repeat(64)), "notebook_request_conflict");
    await fails(() => saveNotebook(batch, id(9184)), "wrong_history_changed");
    await completeWrong(next); const again = await saveNotebook(await notebookInput([next.questions[0]]), id(9185));
    const refs = await rows<{ content_version_id: string; episode_id: string }>("select q.content_version_id,o.episode_id from assignment_questions q join private.notebook_question_origins_v2 o on o.assignment_question_id=q.id where q.assignment_id=any($1::uuid[])", [[saved[0].assignmentId, again[0].assignmentId]]);
    expect(new Set(refs.map(row => row.content_version_id)).size).toBe(1); expect(new Set(refs.map(row => row.episode_id)).size).toBe(2);
  });
  it("같은 구간의 후속 오답 후에도 선택한 이전 문항과 재시험 단계를 보존한다", async () => {
    await notebookSetup(); const a = await exam(186), b = await exam(187, { retry: false });
    await wrongThenRetry(a); await completeWrong(b);
    const batch = await notebookInput([a.questions[0]], "retry");
    expect(batch.questions).toHaveLength(1); expect(batch.questions[0].sourceQuestionId).toBe(a.questions[0]);
    expect(batch.questions[0].sourcePhase).toBe("retry");
  });

  async function practiceInput(e: FakeExam, view: "current" | "history" = "current") {
    const target = (await targets([e.questions[0]]))[0];
    const selected = { mode: "mistakes", view, stateVersion: target.stateVersion,
      meanings: [{ wordKey: (await rows<{ value: string }>("select private.quiz_vocabulary_meaning_v1($1)->>'wordKey' value", [e.questions[0]]))[0].value,
        meaningKey: target.meaningKey, episodeId: target.episodeId }] };
    const raw = (await service<{ value: unknown }>("select public.prepare_student_word_practice_v1($1,$2) value", [student, JSON.stringify(selected)]))[0].value;
    const source = mistakePracticeSourceSchema.parse(raw), first = source.words[0];
    const settings: PracticeSettings = { questionCount: 1, englishToKoreanRatio: first.frozenQuestion.direction === "english_to_korean" ? 100 : 0,
      timingMode: "none", timeLimitSeconds: null, questionTimeLimitSeconds: null };
    const questions = frozenPracticeQuestions(source, settings);
    return { selected, source, settings, questions };
  }
  function frozenPracticeQuestions(source: ReturnType<typeof mistakePracticeSourceSchema.parse>, settings: PracticeSettings) {
    const plan = buildMistakePracticePlan(source, settings, "fixture");
    expect(plan.error).toBeNull();
    const voice = { displayKo: null, variantId: null, audioUrl: null, available: false };
    const questions = plan.items.map(({ word, generated }) => {
      const q = generated ?? word.frozenQuestion;
      return { direction: q.direction, prompt: q.prompt, choices: q.choices, correctChoiceIndex: q.correctChoiceIndex,
        pronunciation: voice, choicePronunciations: [voice, voice, voice, voice],
        choiceSources: generated ? generated.choiceVocabEntryIds.map(id => { const entry = plan.candidates.find(value => value.id === id)!;
          return { entryId: entry.entryId, headword: entry.headword, primaryMeaning: entry.primaryMeaning }; }) : [],
        wordKey: word.wordKey, meaningKey: word.meaningKey, episodeId: word.episodeId, quizContentMode: word.frozenQuestion.quizContentMode,
        sourceQuestionId: word.sourceQuestionId, sourcePhase: word.sourcePhase, sourceContentHash: word.sourceContentHash };
    });
    return questions;
  }
  async function officialSnapshot() {
    const result = [];
    for (const name of ["public.quiz_attempts", "public.quiz_questions", "public.student_vocab_wrong_events", "public.student_vocab_state", "public.student_point_events",
      "public.student_vocab_review_queue", "public.assignment_review_targets", "private.vocabulary_answer_receipts", "private.student_vocabulary_meaning_states", "private.student_vocabulary_versions"]) {
      result.push(await rows(`select coalesce(jsonb_agg(to_jsonb(q) order by to_jsonb(q)::text),'[]') value from ${name} q`));
    }
    return result;
  }
  it.each(["primary_meaning", "definition", "example"] as const)("%s 연습은 공유본문과 작은 참조로 준비/시작되며 정규 오답에 영향을 주지 않는다", async field => {
    await db.query(`insert into vocab_entry_quiz_eligibility(vocab_entry_id,dataset_id,quiz_mode,status,input_content_hash,rule_version,evaluated_at_utc)
      select e.id,e.dataset_id,m.mode,'eligible',e.row_sha256,'fixture',clock_timestamp() from vocab_entries e cross join(values('book_meaning_en_to_ko'),('book_meaning_ko_to_en'))m(mode) where e.dataset_id=$1`, [dataset]);
    const e = await exam(120, field === "primary_meaning" ? {} : { testedField: field }); await answer(e, 0, 1);
    const input = await practiceInput(e), before = await officialSnapshot();
    const args = [student, id(9120), "e".repeat(64), input.selected, input.settings, input.source.sourceHash, input.questions];
    const prep = (await service<{ value: string }>("select public.prepare_word_practice_start_v1($1,$2,$3,$4,$5,$6,$7) value", args))[0].value;
    const compact = (await rows<{ plan: { contentStorageVersion: number; questions: Record<string, unknown>[] } }>("select plan from private.quiz_attempt_preparations where id=$1", [prep]))[0].plan;
    expect(compact.contentStorageVersion).toBe(3); expect(compact.questions[0]).not.toHaveProperty("prompt");
    expect(compact.questions[0]).toMatchObject({ meaningKey: input.questions[0].meaningKey, sourceQuestionId: e.questions[0], episodeId: input.questions[0].episodeId });
    const prepared = (await service<{ value: { plan: { questions: Record<string, unknown>[] } } }>("select public.get_quiz_preparation_v1($1,$2) value", [student, prep]))[0].value;
    expect(prepared.plan.questions[0]).toMatchObject({ prompt: input.questions[0].prompt, quizContentMode: input.questions[0].quizContentMode });
    const run = (await service<{ value: QuizAttemptResponse }>("select public.begin_prepared_practice_v1($1,$2) value", [student, prep]))[0].value;
    expect(run.attempt.questions[0]).toMatchObject({ prompt: input.questions[0].prompt, quizContentMode: input.questions[0].quizContentMode, revealedCorrectChoiceIndex: null });
    expect(run.attempt.questions[0]).not.toHaveProperty("sourceQuestionId");
    await service("select public.answer_student_word_practice_v1($1,$2,$3,$4)", [student, run.attempt.id, run.attempt.questions[0].id, input.questions[0].correctChoiceIndex]);
    expect(await officialSnapshot()).toEqual(before);
    const repeated = (await service<{ value: QuizAttemptResponse }>("select public.start_student_word_practice_v1($1,$2,$3,$4,$5,$6,$7) value", args))[0].value;
    expect(repeated.attempt.id).toBe(run.attempt.id);
  });
  it("연습 준비 후 원뜻 상태가 바뀌면 시작을 거절하고 과거 조회 상한과 기존 시작 결과는 보존한다", async () => {
    const e = await exam(121, { testedField: "definition" }), solve = await exam(122, { testedField: "definition" }); await answer(e, 0, 1);
    const input = await practiceInput(e), args = [student, id(9121), "e".repeat(64), input.selected, input.settings, input.source.sourceHash, input.questions];
    const prep = (await service<{ value: string }>("select public.prepare_word_practice_start_v1($1,$2,$3,$4,$5,$6,$7) value", args))[0].value;
    await answer(solve, 0, 0);
    await fails(() => service("select public.begin_prepared_practice_v1($1,$2)", [student, prep]), "wrong_history_changed");
    await fails(() => service("select public.prepare_student_word_practice_v1($1,$2)", [other, input.selected]), "wrong_history_changed");
    const history = { ...input.selected, view: "history" };
    const past = mistakePracticeSourceSchema.parse((await service<{ value: unknown }>("select public.prepare_student_word_practice_v1($1,$2) value", [student, history]))[0].value);
    expect(past.words[0].episodeId).toBe(input.source.words[0].episodeId);
    const runArgs = [student, id(9122), "f".repeat(64), history, input.settings, past.sourceHash, input.questions];
    const run = (await service<{ value: QuizAttemptResponse }>("select public.start_student_word_practice_v1($1,$2,$3,$4,$5,$6,$7) value", runArgs))[0].value;
    const again = await exam(123, { testedField: "definition" }); await answer(again, 0, 1);
    expect((await service<{ value: QuizAttemptResponse }>("select public.start_student_word_practice_v1($1,$2,$3,$4,$5,$6,$7) value", runArgs))[0].value.attempt.id).toBe(run.attempt.id);
  });
  it("뜻·원문·보기·저장판 위조는 연습 시작 이전에 거절한다", async () => {
    const e = await exam(124, { testedField: "example" }); await answer(e, 0, 1); const input = await practiceInput(e);
    for (const change of [{ meaningKey: "d".repeat(64) }, { wordKey: "another" }, { sourceQuestionId: id(999) }, { sourceContentHash: "0".repeat(64) }, { prompt: "다른 본문" }, { correctChoiceIndex: 2 }, { quizContentMode: "book_meaning_choice" }]) {
      await fails(() => service("select public.start_student_word_practice_v1($1,$2,$3,$4,$5,$6,$7)",
        [student, id(9123), "e".repeat(64), input.selected, input.settings, input.source.sourceHash, [{ ...input.questions[0], ...change }]]), "invalid_practice_questions");
    }
    const compact = (await rows<{ value: unknown[] }>("select private.compact_practice_questions_v3($1) value", [input.questions]))[0].value;
    await fails(() => rows("select private.resolve_practice_preparation_questions_v3($1)", [{ contentStorageVersion: 2, selection: input.selected, questions: compact }]), "practice_content_reference_invalid");
    await fails(() => rows("select private.compact_practice_questions_v2($1)", [input.questions]), "practice_content_version_mismatch");
  });
  it("새 연습 준비의 고정 참조와 소유권은 바꿀 수 없으며 만료 후에도 이미 시작한 연습을 복구한다", async () => {
    const e=await exam(240,{testedField:'definition'});await answer(e,0,1);const input=await practiceInput(e);
    const args=[student,id(9140),'e'.repeat(64),input.selected,input.settings,input.source.sourceHash,input.questions];
    const prep=(await service<{value:string}>('select public.prepare_word_practice_start_v1($1,$2,$3,$4,$5,$6,$7) value',args))[0].value;
    for(const update of ["plan=jsonb_set(plan,'{questions,0,meaningKey}',to_jsonb(repeat('f',64)))",`student_id='${other}'`,
      `request_key='${id(9141)}'`,"request_hash=repeat('f',64)","fingerprint=repeat('f',64)","plan=jsonb_set(plan,'{contentStorageVersion}','2')"]) {
      await fails(()=>rows(`update private.quiz_attempt_preparations set ${update} where id=$1`,[prep]),'question_preparation_immutable');
    }
    await fails(()=>service('select public.start_student_word_practice_v1($1,$2,$3,$4,$5,$6,$7)',[student,id(9140),'f'.repeat(64),...args.slice(3)]),'practice_request_conflict');
    const run=(await service<{value:QuizAttemptResponse}>('select public.start_student_word_practice_v1($1,$2,$3,$4,$5,$6,$7) value',args))[0].value;
    expect((await rows<{begun_id:string}>('select begun_id from private.quiz_attempt_preparations where id=$1',[prep]))[0].begun_id).toBe(run.attempt.id);
    await rows("update private.quiz_attempt_preparations set expires_at=clock_timestamp()-interval '1 second' where id=$1",[prep]);
    const snapshot=await officialSnapshot();
    expect((await service<{value:QuizAttemptResponse}>('select public.begin_prepared_practice_v1($1,$2) value',[student,prep]))[0].value.attempt).toEqual(run.attempt);
    // Emulate an old accepted run whose preparation link was never recorded.
    await rows('update private.quiz_attempt_preparations set begun_id=null where id=$1',[prep]);
    const before=(await rows('select to_jsonb(p) value from private.quiz_attempt_preparations p where id=$1',[prep]))[0];
    expect((await service<{value:{begunId:string}}>('select public.get_quiz_preparation_v1($1,$2) value',[student,prep]))[0].value.begunId).toBe(run.attempt.id);
    expect((await service<{value:string}>('select public.find_word_practice_preparation_v1($1,$2,$3) value',[student,id(9140),'e'.repeat(64)]))[0].value).toBe(run.attempt.id);
    expect((await rows('select to_jsonb(p) value from private.quiz_attempt_preparations p where id=$1',[prep]))[0]).toEqual(before);
    expect((await service<{value:QuizAttemptResponse}>('select public.begin_prepared_practice_v1($1,$2) value',[student,prep]))[0].value.attempt).toEqual(run.attempt);
    expect(await officialSnapshot()).toEqual(snapshot);
  });
  it("조건 전체 연습은 첫10개를 넘어 모든 뜻을 읽고 지난 조회 상한을 유지한다", async () => {
    for(let batch=0;batch<3;batch++) {
      const sourceDataset=batch? id(200+batch):dataset, sourceUnit=batch?id(210+batch):unit;
      if(batch) {
        await rows(`insert into vocab_datasets(id,dataset_key,title,source_label,source_sha256,row_count,status,imported_by)
          values($1,$2,'전체 연습 가짜 책','가짜',repeat('A',64),4,'ready',$3)`,[sourceDataset,`m03-filtered-${batch}`,admin]);
        await rows(`insert into vocab_units(id,dataset_id,unit_label,normalized_label,unit_kind,unit_number,sort_index,entry_count)
          values($1,$2,'DAY 1','day 1','day',1,1,4)`,[sourceUnit,sourceDataset]);
        await rows(`insert into vocab_entries(dataset_id,source_row,headword,headword_normalized,meanings,primary_meaning,row_sha256,unit_id,position_in_unit,entry_type)
          select $1,source_row,'group'||$3::text||headword,'group'||$3::text||headword,meanings,primary_meaning,row_sha256,$2,position_in_unit,entry_type
          from vocab_entries where dataset_id=$4`,[sourceDataset,sourceUnit,batch,dataset]);
      }
      const e=await exam(230+batch,{dataset:sourceDataset,unit:sourceUnit});
      for(let i=0;i<4;i++){await ready(e);await answer(e,i,(i+1)%4);}
    }
    const first=await page({pageSize:10});expect(first.items).toHaveLength(10);expect(first.totalCount).toBe(12);
    const selection={mode:'mistake_filters',stateVersion:first.stateVersion,filters:{view:'current',sort:'count',datasetId:'',level:'all',query:''}};
    const prepareSource=async(selected:typeof selection)=>mistakePracticeSourceSchema.parse((await service<{value:unknown}>(
      'select public.prepare_student_word_practice_v1($1,$2) value',[student,selected]))[0].value);
    const source=await prepareSource(selection);expect(source.words).toHaveLength(12);
    expect(new Set(source.words.map(word=>word.meaningKey)).size).toBe(12);
    const settings:PracticeSettings={questionCount:12,englishToKoreanRatio:100,timingMode:'none',timeLimitSeconds:null,questionTimeLimitSeconds:null};
    const history={...selection,filters:{...selection.filters,view:'history'}};
    const past=await prepareSource(history);
    const solve=await exam(233);await answer(solve,0,0);
    await fails(()=>prepareSource(selection),'wrong_history_changed');
    const stillPast=await prepareSource(history);expect(stillPast.words).toEqual(past.words);
    const questions=frozenPracticeQuestions(stillPast,settings),before=await officialSnapshot();
    const args=[student,id(9130),'d'.repeat(64),history,settings,stillPast.sourceHash,questions];
    const prep=(await service<{value:string}>('select public.prepare_word_practice_start_v1($1,$2,$3,$4,$5,$6,$7) value',args))[0].value;
    const run=(await service<{value:QuizAttemptResponse}>('select public.begin_prepared_practice_v1($1,$2) value',[student,prep]))[0].value;
    expect(run.attempt.questions).toHaveLength(12);expect(await officialSnapshot()).toEqual(before);
  });
  it("현재 보기 검토가 바뀌면 이전 준비를 거절하고 새 연습은 원문 문제로 만들 수 있다", async () => {
    await rows(`insert into vocab_entry_quiz_eligibility(vocab_entry_id,dataset_id,quiz_mode,status,input_content_hash,rule_version,evaluated_at_utc)
      select e.id,e.dataset_id,m.mode,'eligible',e.row_sha256,'fixture',clock_timestamp() from vocab_entries e
      cross join(values('book_meaning_en_to_ko'),('book_meaning_ko_to_en'))m(mode) where e.dataset_id=$1`,[dataset]);
    const e=await exam(260);await answer(e,0,1);const input=await practiceInput(e);
    expect(input.questions[0].choiceSources).toHaveLength(4);
    const args=[student,id(9160),'e'.repeat(64),input.selected,input.settings,input.source.sourceHash,input.questions];
    const prep=(await service<{value:string}>('select public.prepare_word_practice_start_v1($1,$2,$3,$4,$5,$6,$7) value',args))[0].value;
    await rows('delete from vocab_entry_quiz_eligibility where dataset_id=$1',[dataset]);
    await fails(()=>service('select public.begin_prepared_practice_v1($1,$2)',[student,prep]),'practice_source_changed');
    const restored=await practiceInput(e);expect(restored.questions[0].choiceSources).toEqual([]);
    expect(restored.questions[0]).toMatchObject(restored.source.words[0].frozenQuestion);
    const newArgs=[student,id(9161),'f'.repeat(64),restored.selected,restored.settings,restored.source.sourceHash,restored.questions];
    const run=(await service<{value:QuizAttemptResponse}>('select public.start_student_word_practice_v1($1,$2,$3,$4,$5,$6,$7) value',newArgs))[0].value;
    await rows("update vocab_entries set headword='later spelling',primary_meaning='나중 뜻',row_sha256=repeat('C',64) where dataset_id=$1 and source_row=1",[dataset]);
    expect((await service<{value:QuizAttemptResponse}>('select public.start_student_word_practice_v1($1,$2,$3,$4,$5,$6,$7) value',newArgs))[0].value.attempt.id).toBe(run.attempt.id);
    const changed=await practiceInput(e);expect(changed.questions[0].choiceSources).toEqual([]);
    expect(changed.questions[0].prompt).toBe(restored.questions[0].prompt);
  });
  async function adminCurrentCounts() {
    return (await asAdmin("select * from private.admin_student_current_mistake_counts_v1(array[$1]::uuid[])",[student]))[0];
  }
  it("관리자 요약은 단어 카드 기준이며 한 뜻 해결 뒤 반복 오답 수가 줄어든다",async()=>{
    const a=await exam(270),b=await exam(271,{meaning:"두 번째 뜻"}),solve=await exam(272);
    await answer(a,0,1);await answer(b,0,1);
    expect(await adminCurrentCounts()).toEqual({student_id:student,word_count:1,repeated_word_count:1});
    const detail=(await asAdmin<{value:{currentMistakeSummary:unknown;wrongSummary:unknown}}>(
      "select public.get_admin_student_detail_initial_v2($1) value",[student]))[0].value;
    const old=(await asAdmin<{value:{wrongSummary:unknown}}>("select public.get_admin_student_detail_initial_v1($1) value",[student]))[0].value;
    expect(detail.currentMistakeSummary).toEqual({basis:"current_meaning_cards_v1",wordCount:1,repeatedWordCount:1});
    expect(detail.wrongSummary).toEqual(old.wrongSummary);
    await answer(solve,0,0);
    expect(await adminCurrentCounts()).toEqual({student_id:student,word_count:1,repeated_word_count:0});
    await rows("update students set status='blocked',current_vocab_dataset_id=null where id=$1",[student]);
    expect(await adminCurrentCounts()).toEqual({student_id:student,word_count:1,repeated_word_count:0});
    await rows("update students set deleted_at=clock_timestamp(),deleted_by=(select user_id from admin_profiles where is_active limit 1) where id=$1",[student]);
    expect(await adminCurrentCounts()).toBeUndefined();
  });
  it("새 현재 오답 필터는 첫 목록·추가 목록·전체 배정 선택에서 같은 대상을 반환한다",async()=>{
    const a=await exam(273),b=await exam(274);await answer(a,0,1);await answer(b,0,1);
    for(const filter of ["current_wrong","current_repeated"]) {
      const initial=(await asAdmin<{total_count:number;items:{studentId:string}[]}>(
        "select * from public.get_admin_student_directory_initial_v1(p_wrong:=$1)",[filter]))[0];
      expect(Number(initial.total_count)).toBe(1);expect(initial.items.map(x=>x.studentId)).toEqual([student]);
      const next=await asAdmin<{item:{id:string}}>(
        "select * from public.list_admin_student_directory_page_v1('','','','all',null,'',$1,statement_timestamp(),statement_timestamp(),'00000000-0000-0000-0000-000000000000',11)",[filter]);
      expect(next.map(x=>x.item.id)).toEqual([student]);
      const selection=await asAdmin<{student_id:string}>(
        "select * from public.list_admin_assignment_directory_selection_v1(p_wrong:=$1,p_snapshot_at:=statement_timestamp())",[filter]);
      expect(selection.map(x=>x.student_id)).toEqual([student]);
    }
    const solve=await exam(275);await answer(solve,0,0);
    const empty=(await asAdmin<{total_count:number}>("select * from public.get_admin_student_directory_initial_v1(p_wrong:='current_wrong')"))[0];
    expect(Number(empty.total_count)).toBe(0);
    await fails(async()=>{await db.exec("set local role anon");return rows("select * from private.admin_student_current_mistake_counts_v1(array[$1]::uuid[])",[student]);},"permission denied");
  });
  it("분할 시험 둘째 저장이 실패하면 첫 시험과 큐·포인트·현재 오답도 모두 원상복구된다",async()=>{
    await notebookSetup();const b=await exam(276,{meaning:"두 번째 뜻",retry:false}),a=await exam(277,{retry:false});
    await completeWrong(b);await completeWrong(a,[0,1]);
    const batch=await notebookInput([a.questions[1],a.questions[0],b.questions[0]]);
    batch.questions[0].bankIndex=0;batch.questions[1].bankIndex=1;batch.questions[2].bankIndex=1;
    batch.banks=[{...batch.banks[0],index:0,questionCount:1},{...batch.banks[0],index:1,questionCount:2}];
    const tables=["assignments","assignment_questions","assignment_students","assignment_units","private.notebook_question_origins_v2",
      "private.vocabulary_question_content_versions","private.notebook_assignment_requests"];
    const snapshot=async()=>Promise.all(tables.map(name=>rows(`select coalesce(jsonb_agg(to_jsonb(q) order by to_jsonb(q)::text),'[]') value from ${name} q`)));
    const before=await snapshot(),official=await officialSnapshot();
    await fails(()=>saveNotebook(batch,id(9276)),"notebook_invalid_questions");
    expect(await snapshot()).toEqual(before);expect(await officialSnapshot()).toEqual(official);
  });

  it("직접 오답시험은 두 뜻을 분리하고 기존 오답 포인트와 중복 저장 방지를 유지한다",async()=>{
    await notebookSetup();const a=await exam(280,{retry:false}),b=await exam(281,{retry:false,meaning:"별도 뜻"});
    await completeWrong(a);await completeWrong(b);
    expect(await asAdmin("select dataset_id,level_1_count,level_2_count,total_count from public.list_student_direct_mistake_dataset_summaries_v1($1)",[student]))
      .toEqual([{dataset_id:dataset,level_1_count:2,level_2_count:0,total_count:2}]);
    const selection={mode:"direct",datasetId:dataset,reviewLevels:[1,2]};
    const source=mistakePracticeSourceSchema.parse((await service<{value:unknown}>(
      "select public.prepare_book_mistake_assignment_source_v1($1,$2,$3) value",[admin,student,selection]))[0].value);
    const original=await notebookInput([a.questions[0],b.questions[0]]);
    const batch={...original,selection,sourceHash:source.sourceHash,settings:{...original.settings,title:"가짜 직접 오답",questionOrderMode:"fixed",availableFrom:null,availableUntil:null}};
    const save=async(hash="a".repeat(64))=>(await service<{value:{assignmentId:string;studentId:string;questionCount:number}[]}>(
      "select public.create_book_mistake_assignments_v1($1,$2,$3,$4) value",[admin,id(9280),hash,JSON.stringify([batch])]))[0].value;
    const saved=await save();expect(saved).toHaveLength(2);
    expect(await asAdmin("select * from public.list_student_direct_mistake_dataset_summaries_v1($1)",[student])).toEqual([]);
    expect(await rows("select source_kind,points_policy_version,assignment_purpose,question_order_mode from assignments where id=any($1::uuid[]) order by id",[saved.map(x=>x.assignmentId)]))
      .toEqual(Array.from({length:2},()=>({source_kind:"book",points_policy_version:"vocab-points-v1",assignment_purpose:"review",question_order_mode:"fixed"})));
    await rows("set constraints all immediate");
    const pointsBefore=(await rows<{n:number}>("select coalesce(sum(delta),0)::integer n from student_point_events where student_id=$1",[student]))[0].n;
    for(let i=0;i<2;i++){
      const attempt=(await service<{value:string}>("select public.create_quiz_attempt_from_bank($1,$2) value",[student,saved[i].assignmentId]))[0].value;
      const q=(await rows<{id:string;correct_choice_index:number}>("select id,correct_choice_index from quiz_questions where attempt_id=$1",[attempt]))[0];
      const e={assignment:saved[i].assignmentId,attempt,questions:[q.id]};await ready(e);
      const choice=i===0?q.correct_choice_index:(q.correct_choice_index+1)%4;
      await answer(e,0,choice);await answer(e,0,choice);
    }
    expect((await rows<{n:number}>("select coalesce(sum(delta),0)::integer n from student_point_events where student_id=$1",[student]))[0].n-pointsBefore).toBe(2);
    expect(await save()).toEqual(saved);await fails(()=>save("b".repeat(64)),"notebook_request_conflict");
    await fails(()=>rows("update assignments set points_policy_version='no-points-v1' where id=$1",[saved[0].assignmentId]),"assignment_source_points_policy");
  });

  type MixedSource={sourceHash:string;queueIds:string[];blockedPrimaryMeaningKeys:string[];words:{queueId:string;reasonLevel:number;meaningKey:string;sourceQuestionId:string;sourcePhase:string}[]};
  async function mixedSource(levels=[1,2],scope="dataset",unitIds=[unit]){
    return (await service<{value:MixedSource}>("select public.prepare_mixed_mistake_source_v1($1,$2,$3) value",[admin,student,
      {mode:"mixed",datasetId:dataset,primaryUnitIds:unitIds,reviewScope:scope,reviewLevels:levels}]))[0].value;
  }
  it("혼합 원천은 최신 오답으로 교체하지 않고 큐의 원문항·단계와 교육 단계를 보존한다",async()=>{
    await notebookSetup();const a=await exam(310),newer=await exam(311);
    await answer(a,0,1);const [qid]=await queue([a.questions[0]]);await answer(newer,0,1);
    expect((await state(a.questions[0])).current_wrong_count).toBe(2);
    const snapshot=await officialSnapshot(),source=await mixedSource([1]);
    expect(source.words).toMatchObject([{queueId:qid,reasonLevel:1,sourceQuestionId:a.questions[0],sourcePhase:"initial"}]);
    expect(source.queueIds).toEqual([qid]);expect(source.blockedPrimaryMeaningKeys).toEqual([source.words[0].meaningKey]);
    expect(await mixedSource([1])).toEqual(source);expect(await officialSnapshot()).toEqual(snapshot);
    await rows("update student_vocab_review_queue set reason_level=2 where id=$1",[qid]);
    const level1=await mixedSource([1]);expect(level1.words).toEqual([]);expect(level1.blockedPrimaryMeaningKeys).toEqual(source.blockedPrimaryMeaningKeys);
    const level2=await mixedSource([2]);expect(level2.words[0].reasonLevel).toBe(2);expect(level2.sourceHash).not.toBe(source.sourceHash);
  });
  it("혼합 원천은 재시험 큐를 최초 단계로 바꾸지 않는다",async()=>{
    await notebookSetup();const a=await exam(312);await wrongThenRetry(a);
    const selected=(await targets([a.questions[0]])).filter(t=>t.sourcePhase==="retry");
    const qids=(await asAdmin<{value:string[]}>("select public.queue_student_vocabulary_mistakes_v1($1,$2) value",[student,selected]))[0].value;
    const source=await mixedSource();expect(source.words.find(w=>w.queueId===qids[0])).toMatchObject({sourceQuestionId:a.questions[0],sourcePhase:"retry"});
  });
  it("같은 단어의 두 뜻은 모두 유지하고 예약·활성 배정된 뜻은 일반 후보에서도 제외한다",async()=>{
    await notebookSetup();const a=await exam(313),b=await exam(314,{meaning:"별도 원뜻"}),assigned=await exam(315,{meaning:"별도 원뜻"});
    await answer(a,0,1);await answer(b,0,1);const [first]=await queue([a.questions[0]]),[second]=await queue([b.questions[0]]);
    const both=await mixedSource();expect(both.words).toHaveLength(2);expect(new Set(both.words.map(w=>w.meaningKey)).size).toBe(2);
    const draft=id(9313);await rows("insert into student_vocab_review_assignment_drafts(id,student_id,dataset_id,created_by) values($1,$2,$3,$4)",[draft,student,dataset,admin]);
    await rows("update student_vocab_review_queue set reserved_review_draft_id=$2,reserved_at=clock_timestamp() where id=$1",[first,draft]);
    const reserved=await mixedSource();expect(reserved.queueIds).toEqual([second]);expect(reserved.blockedPrimaryMeaningKeys).toEqual(both.blockedPrimaryMeaningKeys);
    const wrongMeaning=await exam(317);
    expect((await rows<{count:number}>("select private.link_pending_review_targets_v2($1,$2,$3) count",[wrongMeaning.assignment,[student],[second]]))[0].count).toBe(0);
    expect((await mixedSource()).queueIds).toEqual([second]);
    expect((await rows<{count:number}>("select private.link_pending_review_targets_v2($1,$2,$3) count",[assigned.assignment,[student],[second]]))[0].count).toBe(1);
    expect(await rows<{review_queue_id:string;meaning_key:string}>(`select t.review_queue_id,
      private.assignment_vocabulary_meaning_v1(t.assignment_question_id)->>'meaningKey' meaning_key
      from assignment_review_targets t where t.assignment_id=$1 and t.student_id=$2 and t.released_at is null`,[assigned.assignment,student]))
      .toEqual([{review_queue_id:second,meaning_key:both.words.find(w=>w.queueId===second)!.meaningKey}]);
    const active=await mixedSource();expect(active.words).toEqual([]);expect(active.blockedPrimaryMeaningKeys).toEqual(both.blockedPrimaryMeaningKeys);
    expect(active.sourceHash).not.toBe(reserved.sourceHash);
  });
  it("혼합 범위 밖 pending 뜻은 선택 오답에 없더라도 일반 후보 제외 목록에 남긴다",async()=>{
    await notebookSetup();const a=await exam(316);await answer(a,0,1);await queue([a.questions[0]]);
    const spare=id(5316);await rows("insert into vocab_units(id,dataset_id,unit_label,normalized_label,unit_kind,unit_number,sort_index,entry_count) values($1,$2,'DAY 2','day 2','day',2,2,0)",[spare,dataset]);
    const all=await mixedSource(),selected=await mixedSource([1,2],"selection",[spare]);
    expect(selected.words).toEqual([]);expect(selected.blockedPrimaryMeaningKeys).toEqual(all.blockedPrimaryMeaningKeys);
    await fails(()=>mixedSource([1,1]),"invalid_mixed_review_selection");
    await fails(()=>mixedSource([1,2],"dataset",[id(999)]),"invalid_mixed_review_selection");
  });

  it.each(["fixed","ascending","descending","random"])("직접 오답시험의 %s 순서를 실제 응시에 적용한다",async order=>{
    await notebookSetup();const a=await exam(282,{retry:false});await completeWrong(a,[0,1]);
    const selection={mode:"direct",datasetId:dataset,reviewLevels:[1,2]};
    const source=(await service<{value:{sourceHash:string;words:{latestVocabEntryId:number}[]}}>(
      "select public.prepare_book_mistake_assignment_source_v1($1,$2,$3) value",[admin,student,selection]))[0].value;
    const original=await notebookInput([a.questions[0],a.questions[1]]);
    original.questions.forEach(q=>{q.bankIndex=0;});
    original.banks=[{...original.banks[0],index:0,questionCount:2}];
    const batch={...original,selection,sourceHash:source.sourceHash,settings:{...original.settings,title:"가짜 순서",questionOrderMode:order,availableFrom:null,availableUntil:null}};
    const saved=(await service<{value:{assignmentId:string}[]}>("select public.create_book_mistake_assignments_v1($1,$2,$3,$4) value",
      [admin,id(9282),"a".repeat(64),JSON.stringify([batch])]))[0].value;
    expect(saved).toHaveLength(1);
    const bank=await rows<{id:string;vocab_entry_id:number}>("select id,vocab_entry_id from assignment_questions where assignment_id=$1 order by base_order_index",[saved[0].assignmentId]);
    const attempt=(await service<{value:string}>("select public.create_quiz_attempt_from_bank($1,$2) value",[student,saved[0].assignmentId]))[0].value;
    const actual=(await rows<{assignment_question_id:string}>("select assignment_question_id from quiz_questions where attempt_id=$1 order by order_index",[attempt])).map(q=>q.assignment_question_id);
    expect(source.words.map(w=>w.latestVocabEntryId)).toEqual([...source.words.map(w=>w.latestVocabEntryId)].sort((a,b)=>a-b));
    const expected=bank.map(q=>q.id);
    expect(actual).toEqual(order==="descending"?expected.toReversed():order==="random"?expect.arrayContaining(expected):expected);
    await rows("set constraints all immediate");
  });

});
