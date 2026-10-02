import { createHash, randomUUID } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { PGlite } from "@electric-sql/pglite";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createFinalSchemaDatabase } from "@/test-support/final-schema-database";
import { loadHistoricalQuestionArchive, saveHistoricalQuestionArchive } from "../../../scripts/historical-question-archive";

const id = (n: number) => `a8030000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const sha = (s: string) => createHash("sha256").update(s).digest("hex");
type Packet = { id: string; before: { kind: "assignment" | "quiz" | "exam-use"; identity: Record<string, unknown>; body: Record<string, unknown>; contentVersionId: null } };
type Receipt = { action: string; rows: number; changed: number; items: Array<{ rowId: string; contentVersionId: string; currentHash: string }> };
type Question = { id: string; correct_choice_index: number };
let db: PGlite;
let endedAttempt: string, activeAttempt: string, retryAttempt: string, pendingPreparation: string, endedPreparation: string;
let oldRows: unknown, oldQuestionReceipt: unknown;
let oldBankIds: string[], oldQuizIds: string[];
const scalar = async <T>(sql: string, args: unknown[] = []) => (await db.query<{ value: T }>(sql, args)).rows[0].value;
const questions = async (attempt: string) => (await db.query<Question>("select id,correct_choice_index from public.quiz_questions where attempt_id=$1 order by order_index", [attempt])).rows;
async function oldExamSource() {
  await db.query(`insert into word_index.app_exam_use_release(release_id,release_key,dataset_id,dataset_key,schema_version,
    package_version,source_sha256,candidate_dictionary_version,manifest_content_hash,exam_review_ledger_sha256,wordbook_id,title,target_environment,
    common_dictionary_release_allowed,exam_use_import_allowed,expected_occurrence_count,expected_dictionary_count,expected_included_count,status,package_json)
    select $2::uuid,'m08-fake:'||$2::text,d.id,d.dataset_key,'1.0',encode(extensions.digest($2::text,'sha256'),'hex'),d.source_sha256,repeat('a',64),repeat('b',64),repeat('c',64),
    'm08-fake','가짜 과거 출처','preview',false,true,4,4,4,'active','{}' from public.vocab_datasets d where d.id=$1`, [id(3), id(20)]);
  await db.query(`insert into word_index.app_exam_use_occurrence(release_id,dataset_id,source_row,vocab_entry_id,unit_id,position_in_unit,
    dictionary_id,sense_id,display_headword,display_gloss_ko,display_pronunciation_review_status,audio_status,listening_enabled,
    occurrence_id,occurrence_content_hash,package_entry_content_hash,exam_review_id,exam_input_hash,exam_use_status,context_evidence_status,context_evidence,
    source_projection_row_sha256,source_entry_id,source_entry_sha256,include_in_exam,audio_json,package_entry_json)
    select $2::uuid,e.dataset_id,e.source_row,e.id,e.unit_id,e.position_in_unit,'word:m08-shared-'||e.source_row,'m08-fake-noun-'||e.source_row,
    e.headword,e.primary_meaning,'candidate','disabled',false,'occ:m08-'||$2::text||'-'||e.source_row,lower(e.row_sha256),lower(e.row_sha256),
    'exam-review:m08-'||$2::text||'-'||e.source_row,lower(e.row_sha256),'reviewed_for_preview','source_entry_context',
    jsonb_build_object('source','source_entries','source_entry_id','m08-entry-'||e.id,'source_entry_sha256',lower(e.row_sha256)),
    e.row_sha256,'m08-entry-'||e.id,lower(e.row_sha256),true,'{"status":"disabled"}','{}' from public.vocab_entries e where e.dataset_id=$1`, [id(3), id(20)]);
  await db.query(`update public.assignment_questions q set question_content_sha256=upper(encode(extensions.digest(
    jsonb_build_array(q.direction,q.prompt,q.choices,q.correct_choice_index,q.entry_row_sha256_snapshot,q.headword_snapshot,q.primary_meaning_snapshot)::text,'sha256'),'hex'))
    where q.assignment_id=$1`, [id(10)]);
  await db.query(`with occurrences as(select o.*,jsonb_build_object('dictionaryId',o.dictionary_id,'displayHeadword',o.display_headword,'displayGlossKo',o.display_gloss_ko,
    'displayPronunciationKo',o.display_pronunciation_ko,'pronunciationVariantId',o.pronunciation_variant_id,'audioStatus',o.audio_status,'audioUrl',o.audio_url,
    'soundAudio',o.sound_audio,'rawResponseSha256',o.raw_response_sha256,'listeningEnabled',o.listening_enabled,'reviewStatus',o.display_pronunciation_review_status) pronunciation
    from word_index.app_exam_use_occurrence o where o.release_id=$2)
    insert into public.assignment_question_exam_use_snapshot(assignment_question_id,assignment_id,dataset_id,vocab_entry_id,release_id,dictionary_id,occurrence_id,sense_id,exam_review_id,
    headword_snapshot,primary_meaning_snapshot,pronunciation_snapshot,choice_dictionary_snapshots,occurrence_content_hash,question_content_sha256,provenance_status)
    select q.id,q.assignment_id,q.dataset_id,q.vocab_entry_id,o.release_id,o.dictionary_id,o.occurrence_id,o.sense_id,o.exam_review_id,o.display_headword,o.display_gloss_ko,o.pronunciation,
      (select jsonb_agg(c.pronunciation||jsonb_build_object('choiceIndex',pick.ord-1,'vocabEntryId',c.vocab_entry_id,'senseId',c.sense_id,'occurrenceContentHash',c.occurrence_content_hash)order by pick.ord)
       from unnest(q.choice_vocab_entry_ids)with ordinality pick(entry_id,ord)join occurrences c on c.vocab_entry_id=pick.entry_id),
    upper(o.occurrence_content_hash),q.question_content_sha256,'reviewed_for_preview_v1'
    from public.assignment_questions q join occurrences o on o.vocab_entry_id=q.vocab_entry_id and o.dataset_id=q.dataset_id where q.assignment_id=$1`, [id(10), id(20)]);
}
const getIds = async (assignment: string, kind = "assignment") => kind === "assignment"
  ? (await db.query<{ id: string }>("select id from public.assignment_questions where assignment_id=$1 order by base_order_index", [assignment])).rows.map(r => r.id)
  : (await db.query<{ id: string }>("select q.id from public.quiz_questions q join public.quiz_attempts a on a.id=q.attempt_id where a.assignment_id=$1 order by q.order_index", [assignment])).rows.map(r => r.id);
const raw = (kind: string, rowId: string) => scalar<Record<string, unknown>>("select private.historical_question_row_v1($1,$2) value", [kind, rowId]);
const prepare = (assignment: string, kind: string, ids: string[]) => scalar<Packet[]>("select private.prepare_historical_question_batch_v1($1,$2,$3) value", [assignment, kind, ids]);
const apply = (packets: Packet[], action = "compact", request = randomUUID(), fileHash = "a".repeat(64)) =>
  scalar<Receipt>("select private.apply_historical_question_batch_v1($1,$2,$3,$4::jsonb) value", [request, action, fileHash, JSON.stringify(packets)]);
const preserved = () => scalar(`select jsonb_build_object(
  'attempts',(select jsonb_agg(to_jsonb(a) order by id)from public.quiz_attempts a),
  'answers',(select jsonb_agg(to_jsonb(q)-array['prompt','choices','content_version_id'] order by id)from public.quiz_questions q),
  'wrong',(select jsonb_agg(to_jsonb(e) order by id)from public.student_vocab_wrong_events e),
  'policies',(select jsonb_agg(to_jsonb(p) order by attempt_id)from private.vocabulary_result_policies p),
  'results',(select jsonb_agg(to_jsonb(r) order by attempt_id,phase)from private.vocabulary_phase_results r),
  'receipts',(select jsonb_agg(to_jsonb(r) order by quiz_question_id,phase)from private.vocabulary_answer_receipts r),
  'points',(select jsonb_agg(to_jsonb(p) order by id)from public.student_point_events p),
  'plans',(select jsonb_agg(to_jsonb(p) order by attempt_id,phase)from private.local_quiz_phase_plans p),
  'localReceipts',(select jsonb_agg(to_jsonb(r) order by submission_id)from private.local_quiz_phase_receipts r)) value`);
const ordinaryRows = (hasReference: boolean) => scalar(`select jsonb_build_object(
  'bank',(select jsonb_agg(to_jsonb(q)${hasReference ? "-'content_version_id'" : ""} order by id)from public.assignment_questions q),
  'questions',(select jsonb_agg(to_jsonb(q)${hasReference ? "-'content_version_id'" : ""} order by id)from public.quiz_questions q),
  'exam',(select jsonb_agg(to_jsonb(q)${hasReference ? "-'content_version_id'" : ""} order by assignment_question_id)from public.assignment_question_exam_use_snapshot q),
  'preparations',(select jsonb_agg(to_jsonb(p) order by id)from private.quiz_attempt_preparations p),
  'attempts',(select jsonb_agg(to_jsonb(a) order by id)from public.quiz_attempts a)) value`);
async function reject(action: () => Promise<unknown>, message: string | RegExp) {
  await db.exec("savepoint expected_failure");
  try { await expect(action()).rejects.toThrow(message); }
  finally { await db.exec("rollback to expected_failure; release expected_failure"); }
}
async function answer(attempt: string, question: Question, index: number, correct = true) {
  if (index) await db.query("select public.resume_quiz_after_feedback_v2($1,$2,$3,'initial',0)", [id(2), attempt, question.id]);
  return scalar("select public.answer_quiz_question_v4($1,$2,$3,'initial',$4::smallint,false) value",
    [id(2), attempt, question.id, correct ? question.correct_choice_index : (question.correct_choice_index + 1) % 4]);
}
async function compactEnded() {
  const bank = await prepare(id(10), "assignment", oldBankIds);
  const quiz = await prepare(id(10), "quiz", oldQuizIds);
  await apply([...bank, ...quiz]);
  return [...bank, ...quiz];
}

describe.sequential("operator migration of actual historical question bodies", () => {
  beforeAll(async () => {
    db = await createFinalSchemaDatabase({ beforeMigration: async (database, migration) => {
      if (migration !== "20261001145444_share_vocabulary_question_content.sql") return;
      db = database;
      expect(await scalar("select to_regclass('private.vocabulary_question_content_versions')::text value")).toBeNull();
      await db.exec(`
        insert into auth.users(id) values('${id(1)}');
        insert into public.admin_profiles(user_id,display_name) values('${id(1)}','Fake historical operator');
        insert into public.students(id,display_name,created_by,school_name,grade_label)
          select x,'Fake historical learner','${id(1)}','Fake school','고2' from unnest(array['${id(2)}','${id(5)}']::uuid[])x;
        insert into public.vocab_datasets(id,dataset_key,title,source_label,source_sha256,row_count,status,imported_by)
          values('${id(3)}','fake-historical-body','Fake old words','Fake',repeat('A',64),4,'ready','${id(1)}');
        insert into public.vocab_units(id,dataset_id,unit_label,normalized_label,unit_kind,unit_number,sort_index,entry_count)
          values('${id(4)}','${id(3)}','DAY 1','day1','day',1,1,4);
        insert into public.vocab_entries(dataset_id,source_row,headword,headword_normalized,meanings,primary_meaning,row_sha256,unit_id,position_in_unit,entry_type)
          select '${id(3)}',n,'oldword'||n,'oldword'||n,array['당시 뜻'||n],'당시 뜻'||n,repeat('B',63)||n::text,'${id(4)}',n,'word' from generate_series(1,4)n;
        insert into public.assignments(id,title,dataset_id,range_start,range_end,question_count,english_to_korean_ratio,time_limit_seconds,
          timing_mode,passing_score,status,created_by,retake_allowed,range_basis,question_bank_version,question_order_mode)
          select x,'Fake historical test','${id(3)}',1,4,4,100,240,'none',80,'active','${id(1)}',true,'units',1,'fixed'
          from unnest(array['${id(10)}','${id(11)}','${id(12)}','${id(13)}','${id(14)}']::uuid[])x;
        insert into public.assignment_units(assignment_id,dataset_id,unit_id,position,is_primary)
          select id,'${id(3)}','${id(4)}',1,true from public.assignments;
        insert into public.assignment_students(assignment_id,student_id,assigned_by)
          select a.id,s.id,'${id(1)}' from public.assignments a cross join public.students s;
        insert into public.assignment_questions(assignment_id,dataset_id,vocab_entry_id,base_order_index,direction,prompt,choices,
          correct_choice_index,headword_snapshot,primary_meaning_snapshot,choice_vocab_entry_ids)
          select a.id,'${id(3)}',e.id,e.source_row,'english_to_korean',e.headword,
            (select jsonb_agg(primary_meaning order by source_row)from public.vocab_entries),(e.source_row-1)::smallint,
            e.headword,e.primary_meaning,(select array_agg(id order by source_row)from public.vocab_entries)
          from public.assignments a cross join public.vocab_entries e;
        select set_config('request.jwt.claim.role','service_role',false);
      `);
      await oldExamSource();
      endedPreparation = await scalar("select public.prepare_quiz_attempt_v1($1,$2,null) value", [id(2), id(10)]);
      endedAttempt = await scalar("select public.begin_prepared_quiz_v1($1,$2) value", [id(2), endedPreparation]);
      for (const [i, q] of (await questions(endedAttempt)).entries()) await answer(endedAttempt, q, i);
      activeAttempt = await scalar("select public.create_quiz_attempt_from_bank($1,$2) value", [id(2), id(11)]);
      oldQuestionReceipt = await answer(activeAttempt, (await questions(activeAttempt))[0], 0);
      retryAttempt = await scalar("select public.create_quiz_attempt_from_bank($1,$2) value", [id(2), id(12)]);
      for (const [i, q] of (await questions(retryAttempt)).entries()) await answer(retryAttempt, q, i, false);
      pendingPreparation = await scalar("select public.prepare_quiz_attempt_v1($1,$2,null) value", [id(2), id(13)]);
      await db.query("update public.assignments set status='closed' where id=any($1::uuid[])", [[id(10), id(11), id(12), id(13)]]);
      oldRows = await ordinaryRows(false);
    } });
    oldBankIds = await getIds(id(10)); oldQuizIds = await getIds(id(10), "quiz");
  }, 120_000);
  beforeEach(async () => { await db.exec("reset role; begin"); });
  afterEach(async () => { await db.exec("rollback; reset role"); });
  afterAll(async () => { await db?.close(); });

  it("keeps actual pre-M02 bodies, completed/active/retry states, preparations and original IDs", async () => {
    expect(await ordinaryRows(true)).toEqual(oldRows);
    expect(await scalar("select count(*)::int value from private.historical_question_migrations")).toBe(0);
    expect(await scalar("select count(*)::int value from private.vocabulary_question_content_versions")).toBe(0);
    expect(await scalar("select status::text value from public.quiz_attempts where id=$1", [endedAttempt])).toBe("completed");
    expect(await scalar("select phase::text value from public.quiz_attempts where id=$1", [retryAttempt])).toBe("review");
    expect(await scalar("select jsonb_typeof(plan) value from private.quiz_attempt_preparations where id=$1", [pendingPreparation])).toBe("array");
    expect(oldQuestionReceipt).toBeDefined();
  });

  it("prepares content references without clearing a body, then processes two rows and reuses exact references", async () => {
    const original = await ordinaryRows(true), studentState = await preserved();
    const bank = await prepare(id(10), "assignment", oldBankIds);
    const quiz = await prepare(id(10), "quiz", oldQuizIds);
    expect(await ordinaryRows(true)).toEqual(original);
    expect(await prepare(id(10), "assignment", oldBankIds)).toEqual(bank);
    expect(await scalar("select count(*)::int value from private.vocabulary_question_content_versions")).toBe(4);
    const first = await apply(bank.slice(0, 2));
    expect(first.changed).toBe(2);
    expect(await scalar("select count(*)::int value from public.assignment_questions where assignment_id=$1 and prompt is not null", [id(10)])).toBe(2);
    await apply(bank.slice(2)); await apply(quiz);
    for (const packet of [...bank, ...quiz]) {
      const rowId = String(packet.before.identity.id);
      const current = await raw(packet.before.kind, rowId);
      expect(current.prompt).toBeNull();
      const resolved = await scalar("select private.historical_question_document_v1($1,private.historical_question_resolve_v1($1,$2::jsonb))-'contentVersionId' value", [packet.before.kind, JSON.stringify(current)]);
      const { contentVersionId: ignored, ...expected } = packet.before; void ignored;
      expect(resolved).toEqual(expected);
    }
    expect(await preserved()).toEqual(studentState);
    expect(await scalar("select count(*)::int value from private.assignment_vocabulary_meaning_refs")).toBe(4);
    expect(await scalar("select count(*)::int value from private.historical_question_write_permits")).toBe(0);
    expect(await scalar("select private.retention_compact_preparation_v1(p) is not null value from private.quiz_attempt_preparations p where id=$1", [endedPreparation])).toBe(true);
  });

  it("replays the original request exactly and rejects a different payload using the same request", async () => {
    const packets = await prepare(id(10), "assignment", oldBankIds), request = randomUUID();
    const first = await apply(packets, "compact", request);
    expect(await apply(packets, "compact", request)).toEqual(first);
    expect((await apply(packets)).changed).toBe(0);
    await reject(() => apply(packets.slice(0, 2), "compact", request), "historical_question_request_conflict");
  });

  it("converts and restores historical exam-use source bodies while keeping their original meanings and references", async () => {
    const before = await preserved(), meanings = await scalar("select jsonb_agg(private.assignment_vocabulary_meaning_v1(id)order by id) value from public.assignment_questions where assignment_id=$1", [id(10)]);
    const source = await prepare(id(10), "exam-use", oldBankIds);
    await compactEnded();
    expect((await apply(source)).changed).toBe(4);
    expect(await scalar("select bool_and(headword_snapshot is null and content_version_id is not null) value from public.assignment_question_exam_use_snapshot where assignment_id=$1", [id(10)])).toBe(true);
    expect((await apply(source, "restore")).changed).toBe(4);
    for (const packet of source) {
      const row = await raw("exam-use", String(packet.before.identity.assignment_question_id));
      expect(row.content_version_id).not.toBeNull();
      expect(row.headword_snapshot).toBe(packet.before.body.headword_snapshot);
      expect(row.choice_dictionary_snapshots).toEqual(packet.before.body.choice_dictionary_snapshots);
    }
    expect(await scalar("select jsonb_agg(private.assignment_vocabulary_meaning_v1(id)order by id) value from public.assignment_questions where assignment_id=$1", [id(10)])).toEqual(meanings);
    expect(await preserved()).toEqual(before);
  });

  it("rejects a changed archive/identity and rolls the entire batch back on a later invalid row", async () => {
    const packets = await prepare(id(10), "assignment", oldBankIds);
    const altered = structuredClone(packets); altered[3].before.body.prompt = "Changed after backup";
    const before = await ordinaryRows(true);
    await reject(() => apply(altered), "historical_question_archive_mismatch");
    expect(await ordinaryRows(true)).toEqual(before);
    expect(await scalar("select count(*)::int value from private.historical_question_migration_receipts")).toBe(0);
    await reject(() => apply([packets[0], packets[0]]), "historical_question_batch_invalid");
    await reject(() => prepare(id(11), "assignment", oldBankIds), "historical_question_attempt_pending");
    await reject(() => prepare(id(10), "assignment", [randomUUID()]), "historical_question_missing");
  });

  it("rejects the same candidate twice even when its UUID is written with different casing", async () => {
    const packets = await prepare(id(10), "assignment", oldBankIds);
    const packet = packets.find((item) => /[a-f]/.test(item.id))!;
    expect(packet).toBeDefined();
    const before = await ordinaryRows(true);
    await reject(() => apply([packet, { ...packet, id: packet.id.toUpperCase() }]), "historical_question_batch_invalid");
    expect(await ordinaryRows(true)).toEqual(before);
    expect(await scalar("select count(*)::int value from private.historical_question_migration_receipts")).toBe(0);
  });

  it("excludes an open bank, active answer, retry, unstarted preparation and new result-policy run", async () => {
    await reject(async () => prepare(id(14), "assignment", await getIds(id(14))), "historical_question_assignment_open");
    await reject(async () => prepare(id(11), "assignment", await getIds(id(11))), "historical_question_attempt_pending");
    await reject(async () => prepare(id(12), "assignment", await getIds(id(12))), "historical_question_attempt_pending");
    await reject(async () => prepare(id(13), "assignment", await getIds(id(13))), "historical_question_preparation_pending");
    const newRun = await scalar<string>("select public.create_quiz_attempt_from_bank($1,$2) value", [id(2), id(14)]);
    for (const [i, q] of (await questions(newRun)).entries()) await answer(newRun, q, i);
    await db.query("update public.assignments set status='closed' where id=$1", [id(14)]);
    await reject(async () => prepare(id(14), "assignment", await getIds(id(14))), "historical_question_result_policy");
  });

  it("restores only verified bodies from a real file, keeping newer answers and the same receipt", async () => {
    const packets = [...await prepare(id(10), "assignment", oldBankIds), ...await prepare(id(10), "quiz", oldQuizIds), ...await prepare(id(10), "exam-use", oldBankIds)];
    const directory = process.env.HISTORICAL_QUIZ_BACKUP_DIR ?? fs.mkdtempSync(path.join(os.tmpdir(), "fake-quiz-migration-"));
    fs.mkdirSync(directory, { recursive: true });
    const saved = saveHistoricalQuestionArchive(directory, { schemaVersion: "historical-question-archive-v1", origin: "local-synthetic", packets });
    const filename = saved.path, serialized = fs.readFileSync(filename, "utf8");
    const loadedBytes = fs.readFileSync(filename);
    expect(sha(loadedBytes.toString())).toBe(sha(serialized));
    expect(saved.sha256).toBe(sha(serialized));
    await apply(saved.parameters.p_rows, "compact", randomUUID(), saved.parameters.p_archive_sha256);
    const reloaded = loadHistoricalQuestionArchive(filename, saved.sha256);
    const newerQuestion = (await questions(activeAttempt))[1];
    const newerReceipt = await answer(activeAttempt, newerQuestion, 1);
    const beforeRestore = await preserved();
    const request = randomUUID(), restored = await apply(reloaded.parameters.p_rows, "restore", request, saved.sha256);
    expect(restored.changed).toBe(12);
    expect(await preserved()).toEqual(beforeRestore);
    expect(await apply(reloaded.parameters.p_rows, "restore", request, saved.sha256)).toEqual(restored);
    expect((await apply(reloaded.parameters.p_rows, "restore", randomUUID(), saved.sha256)).changed).toBe(0);
    for (const packet of packets) {
      const row = await raw(packet.before.kind, String(packet.before.identity.id ?? packet.before.identity.assignment_question_id));
      expect(row.content_version_id).not.toBeNull();
      expect(Object.fromEntries(Object.keys(packet.before.body).map(key => [key, row[key]]))).toEqual(packet.before.body);
    }
    expect(await scalar("select public.answer_quiz_question_v4($1,$2,$3,'initial',$4::smallint,false) value",
      [id(2), activeAttempt, newerQuestion.id, newerQuestion.correct_choice_index])).toEqual(newerReceipt);
    const oldQuestion = (await questions(activeAttempt))[0];
    await reject(() => scalar("select public.answer_quiz_question_v4($1,$2,$3,'initial',$4::smallint,false) value",
      [id(2), activeAttempt, oldQuestion.id, oldQuestion.correct_choice_index]), "question_already_answered");
    fs.writeFileSync(filename.replace(".json", ".verification.json"), JSON.stringify({
      synthetic: true, bytes: loadedBytes.length, sha256: sha(serialized), restoredRows: restored.changed,
      fileReadBeforeCompact: true, newAnswersPreserved: true, sameReceipt: true, referenceKept: true,
    }, null, 2), { flag: "wx", mode: 0o600 });
  });

  it("rechecks dependent quiz references when an independently prepared bank is applied later", async () => {
    const quiz = await prepare(id(10), "quiz", oldQuizIds);
    await db.query("update public.assignment_questions set primary_meaning_snapshot='Changed label only' where id=any($1)", [oldBankIds]);
    const bank = await prepare(id(10), "assignment", oldBankIds);
    await apply(quiz);
    await reject(() => apply(bank), "historical_question_dependent_reference_mismatch");
    expect(await scalar("select bool_and(prompt is not null and content_version_id is null) value from public.assignment_questions where assignment_id=$1", [id(10)])).toBe(true);
    expect(await scalar("select count(*)::int value from private.quiz_question_contents_v1 where attempt_id=$1", [endedAttempt])).toBe(4);
  });

  it("rejects a stale source row after preparation even when the unchanged file is valid", async () => {
    const packets = await prepare(id(10), "assignment", oldBankIds);
    await db.query("update public.assignment_questions set primary_meaning_snapshot='Different saved value' where id=$1", [oldBankIds[0]]);
    await reject(() => apply(packets), "historical_question_current_changed");
    expect(await scalar("select count(*)::int value from public.assignment_questions where content_version_id is not null")).toBe(0);
    const refreshed = await prepare(id(10), "assignment", oldBankIds);
    expect(refreshed.find(p => p.before.identity.id === oldBankIds[0])?.id).not.toBe(packets.find(p => p.before.identity.id === oldBankIds[0])?.id);
  });

  it("excludes a genuinely completed device-bound run and keeps its original batch receipt", async () => {
    const device = "a".repeat(64);
    const prep = await scalar<{ preparationId: string; planHash: string }>("select public.prepare_local_quiz_v1($1,$2,$3,null) value", [id(2), id(14), device]);
    const plan = await scalar<{ attemptId: string; planHash: string; items: Array<{ id: string; correctChoiceIndex: number }> }>(
      "select public.begin_local_quiz_v1($1,$2,$3,$4) value", [id(2), prep.preparationId, device, prep.planHash]);
    const entries = plan.items.map((q, i) => ({ id: q.id, order: i + 1, kind: "answer", choice: q.correctChoiceIndex, openedMs: i * 100, elapsedMs: i * 100 }));
    const request = randomUUID(), args = [id(2), plan.attemptId, "initial", device, plan.planHash, request, JSON.stringify(entries), JSON.stringify({ elapsedMs: 300, reason: "answered" })];
    const sql = "select public.submit_local_quiz_phase_v1($1,$2,$3,$4,$5,$6,$7::jsonb,$8::jsonb) value";
    const receipt = await scalar(sql, args);
    await db.query("update public.assignments set status='closed' where id=$1", [id(14)]);
    const before = await preserved();
    await reject(async () => prepare(id(14), "assignment", await getIds(id(14))), "historical_question_device_bound");
    expect(await preserved()).toEqual(before);
    expect(await scalar(sql, args)).toEqual(receipt);
  });

  it("requires a verified external file and refuses tampered or repository-local archives", async () => {
    const packets = await prepare(id(10), "assignment", oldBankIds);
    expect(() => saveHistoricalQuestionArchive(process.cwd(), { schemaVersion: "historical-question-archive-v1", origin: "local-synthetic", packets })).toThrow("앱 저장소 밖");
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), "fake-quiz-archive-reject-"));
    const saved = saveHistoricalQuestionArchive(directory, { schemaVersion: "historical-question-archive-v1", origin: "local-synthetic", packets });
    fs.appendFileSync(saved.path, " ");
    expect(() => loadHistoricalQuestionArchive(saved.path, saved.sha256)).toThrow("내용이 달라졌습니다");
    expect(await scalar("select count(*)::int value from public.assignment_questions where content_version_id is not null")).toBe(0);
  });

  it("permits body restoration after the assignment reopens and new answers exist on the same bank", async () => {
    const packets = await compactEnded();
    await db.query("update public.assignments set status='active' where id=$1", [id(10)]);
    const newRun = await scalar<string>("select public.create_quiz_attempt_from_bank($1,$2) value", [id(5), id(10)]);
    const q = (await questions(newRun))[0];
    await scalar("select public.answer_quiz_question_v4($1,$2,$3,'initial',$4::smallint,false) value", [id(5), newRun, q.id, q.correct_choice_index]);
    const latest = await preserved();
    await reject(() => apply(packets), "historical_question_assignment_open");
    expect((await apply(packets, "restore")).changed).toBe(8);
    expect(await preserved()).toEqual(latest);
    expect((await raw("quiz", q.id)).prompt).toBeNull();
  });

  it("keeps direct writes and fake session flags blocked, and clears new question bodies normally", async () => {
    await compactEnded();
    await db.exec("select set_config('app.historical_question_restore','true',true)");
    await reject(() => db.query("update public.assignment_questions set prompt='forged' where id=$1", [oldBankIds[0]]), /immutable/);
    await reject(() => db.query("update public.quiz_questions set prompt='forged' where id=$1", [oldQuizIds[0]]), /immutable/);
    await reject(() => db.query("update public.quiz_questions set content_version_id=null,prompt='word',choices='[\"a\",\"b\",\"c\",\"d\"]' where id=$1", [oldQuizIds[0]]), /immutable/);
    const newRun = await scalar<string>("select public.create_quiz_attempt_from_bank($1,$2) value", [id(2), id(14)]);
    expect(await scalar("select bool_and(content_version_id is not null and prompt is null and choices is null) value from public.quiz_questions where attempt_id=$1", [newRun])).toBe(true);
  });

  it("rejects every app role and preserves RLS, no exported execution grants, and ordinary failure contracts", async () => {
    expect(await scalar("select bool_and(relrowsecurity) value from pg_class where oid=any(array['private.historical_question_migrations'::regclass,'private.historical_question_migration_receipts'::regclass,'private.historical_question_write_permits'::regclass])")).toBe(true);
    for (const role of ["anon", "authenticated", "service_role"]) {
      await db.exec(`set local role ${role}`);
      await reject(() => prepare(id(10), "assignment", oldBankIds), /permission denied/);
      await reject(() => db.query("insert into private.historical_question_write_permits values(pg_backend_pid(),txid_current(),1,'x','y')"), /permission denied/);
      await db.exec("reset role");
    }
    expect(await scalar("select count(*)::int value from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='private' and p.proname like '%historical_question%' and (has_function_privilege('anon',p.oid,'execute') or has_function_privilege('authenticated',p.oid,'execute') or has_function_privilege('service_role',p.oid,'execute'))")).toBe(0);
  });
});
