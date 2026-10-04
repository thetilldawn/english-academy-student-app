import { createHash, randomUUID } from "node:crypto";
import type { PGlite } from "@electric-sql/pglite";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { localPhasePlanSchema, localReceiptSchema, type LocalBatch, type LocalPhasePlan } from "@/features/quiz-player/contracts/local-quiz";
import { receiptConfirmsBatch } from "@/features/quiz-player/domain/local-quiz";
import { mistakePracticeSourceSchema } from "@/features/quiz-player/domain/mistake-practice-plan";
import { createFinalSchemaDatabase } from "@/test-support/final-schema-database";
import { EMPTY_LIBRARY_FILTERS, libraryCatalogSchema, libraryCommandResultSchema } from "@/features/wordbook-compositions/contracts/library";
import { compositionQuestionInputSchema, compositionStepSchema } from "@/features/wordbook-compositions/contracts/library-materialization";

const migration = "20261004083102_reuse_original_vocabulary_keys_in_selections.sql";
const adminId = "a9100000-0000-4000-8000-000000000001";
const studentId = "a9100000-0000-4000-8000-000000000002";
const project = "wojxpruvbjzbhrpmsbuy";
const device = "d".repeat(64);
const sha = (value: string) => createHash("sha256").update(value).digest("hex");
type Direction = "english_to_korean" | "korean_to_english";
type Target = { vocab_entry_id: number; base_order_index: number; direction: Direction; composition_bank: { mode: string; version_id: string; content_sha256: string; question_item_id: string; question_item_sha256: string } };
type Book = { datasetId: string; units: string[]; plan: Target[]; direction: Direction };

describe.sequential("배정의 두 공용 확인값을 중복 저장하지 않고 원형으로 복원한다", () => {
  let db: PGlite, standard: Book, fresh: Book, ambiguous: Book, duplicate: Book;
  let previousRows: unknown, previousAttributes: unknown, oldAssignment: string;
  let oldPreparation: { preparationId: string; planHash: string };
  const scalar = async <T = unknown>(sql: string, values: unknown[] = []) => (await db.query<{ value: T }>(sql, values)).rows[0].value;
  const owner = () => db.exec("reset role");
  const admin = () => db.exec(`reset role; set role authenticated; select set_config('request.jwt.claim.sub','${adminId}',false); select set_config('request.jwt.claim.role','authenticated',false)`);
  const service = () => db.exec("reset role; set role service_role; select set_config('request.jwt.claim.role','service_role',false)");

  async function seedBook(key: string, direction: Direction = "english_to_korean", lowerBoundaryDuplicate = false): Promise<Book> {
    await owner();
    const source = await scalar<string>("insert into public.vocab_datasets(dataset_key,title,source_label,source_sha256,row_count,status,is_active) values($1,$2,'fake',repeat('A',64),4,'ready',true) returning id value", ["fake-direct-" + key, "가짜 " + key]);
    const unit = await scalar<string>("insert into public.vocab_units(dataset_id,unit_label,normalized_label,unit_kind,unit_number,sort_index,entry_count) values($1,'DAY 1','day1','day',1,1,4) returning id value", [source]);
    await db.query("insert into public.vocab_dataset_catalog(dataset_id,display_name,catalog_group,material_kind) values($1,$2,'high','wordbook')", [source, "가짜 " + key]);
    const meanings = direction === "korean_to_english" ? ["가짜 뜻 1", "가짜 뜻 1*", "가짜 뜻 3", "가짜 뜻 4"] : [1, 2, 3, 4].map(n => "가짜 " + key + " 뜻 " + n);
    await db.query(`insert into public.vocab_entries(dataset_id,source_row,headword,headword_normalized,meanings,primary_meaning,row_sha256,unit_id,position_in_unit,entry_type)
      select $1,n,'direct'||$3||n,'direct'||$3||n,array[($4::text[])[n]],($4::text[])[n],upper(encode(extensions.digest($3||':'||n,'sha256'),'hex')),$2,n,'word' from generate_series(1,4)n`, [source, unit, key, meanings]);
    await db.query(`insert into public.vocab_entry_quiz_eligibility(vocab_entry_id,dataset_id,quiz_mode,status,input_content_hash,rule_version,evaluated_at_utc)
      select id,dataset_id,$2,'eligible',row_sha256,'fake',now() from public.vocab_entries where dataset_id=$1`, [source, direction === "english_to_korean" ? "book_meaning_en_to_ko" : "book_meaning_ko_to_en"]);
    const rows = (await db.query<{ source_row: number; row_hash: string }>("select source_row,lower(row_sha256) row_hash from public.vocab_entries where dataset_id=$1 order by source_row", [source])).rows;
    const selected = { schemaVersion: "vocabulary-resource-snapshot-v1", sourceFields: {}, proofs: {}, pronunciation: { displayKo: null, variantId: null, audioUrl: null, available: false }, lexicalPos: null, dictionary: null, senseId: null, definitionEn: null, exampleEn: null, exampleKo: null };
    const bundle = { schemaVersion: "vocabulary-library-import-v1", sourceCatalogHash: sha("catalog" + key), linksHash: sha("links" + key), referenceCatalogHash: sha("refs" + key), scopes: [{
      key: "direct-" + key, name: "가짜 " + key, sourceTitle: "가짜 " + key,
      source: { datasetId: source, unitId: unit, kind: "legacy_vocab", releaseId: null, releaseVersion: "a".repeat(64), fileHash: sha("file" + key), locator: "fake.json" },
      classification: { kind: "wordbook", sourceGrade: "g11", exam: null, lesson: null, day: 1, publisher: null, school: null, targetGrade: null, schoolYear: null, semester: null, assessment: null, purpose: null },
      rows: rows.map(r => ({ sourceRow: r.source_row, rowHash: r.row_hash, resources: { entryHash: r.row_hash, linkRecordHash: sha(key + ":" + r.source_row), selected } })),
    }] };
    const text = JSON.stringify(bundle), hash = await scalar<string>("select private.reviewed_exam_sha256_v1($1::jsonb) value", [text]);
    await db.query("insert into private.vocabulary_library_import_approvals values($1,$2,$3,1,$4)", [project, sha(text), hash, "fake-direct-" + key]);
    await service(); await db.query("select public.import_vocabulary_library_v1($1::text)", [text]); await admin();
    const scopes = libraryCatalogSchema.parse(await scalar("select public.list_vocabulary_library_v1() value")).scopes.filter(s => s.name === "가짜 " + key);
    expect(scopes).toHaveLength(1);
    const template = libraryCommandResultSchema.parse(await scalar("select public.save_vocabulary_library_template_v1($1::jsonb) value", [{ action: "create", requestId: randomUUID(), metadata: { title: "가짜 " + key, tags: [], school: null, targetGrade: null, schoolYear: null, semester: null, assessment: null, purpose: null }, recipe: { filters: EMPTY_LIBRARY_FILTERS, scopes: scopes.map(s => ({ id: s.id, version: s.version })), excludedOccurrenceKeys: [], scopeStatus: "confirmed" } }])).template;
    const command = { action: "materialize", requestId: randomUUID(), templateId: template.id, versionId: template.versions[0]!.id, contentHash: template.versions[0]!.contentHash };
    for (let n = 0; n < 6; n++) {
      const state = compositionStepSchema.parse(await scalar("select public.advance_vocabulary_template_book_v1($1::jsonb) value", [command]));
      if (state.stage === "prepared") break;
      if (n === 5) throw Error("fake book preparation did not finish");
    }
    const prep = compositionQuestionInputSchema.parse(await scalar("select public.prepare_vocabulary_template_question_input_v1($1::jsonb) value", [command]));
    const questions = prep.entries.map((entry, i) => {
      const choices = Array.from({ length: 4 }, (_, j) => prep.entries[(i + j) % 4]);
      return { vocabEntryId: entry.id, direction, prompt: direction === "english_to_korean" ? entry.headword : entry.primaryMeaning,
        choices: choices.map(c => direction === "english_to_korean" ? c.primaryMeaning : c.headword), choiceVocabEntryIds: choices.map(c => c.id), correctChoiceIndex: 0 };
    });
    if (lowerBoundaryDuplicate) {
      // A deliberately invalid stored bank, not an accepted importer result.
      // Keep every protection enabled. Only this new fixture's items are inserted
      // directly so the assignment's final duplicate defense is actually reached.
      await owner();
      for (const q of questions) {
        q.choices[2] = q.choices[1];
        const lineage = await scalar<{ occurrenceKey: string; resources: unknown; pronunciation: unknown }>(`select jsonb_build_object('occurrenceKey',occurrence_key,'resources',resources,
          'pronunciation',private.vocabulary_composition_resource_v1(resources)->'pronunciation') value from private.vocabulary_composition_entries where vocab_entry_id=$1`, [q.vocabEntryId]);
        const proof = { sourceKind: "generated_meaning", generator: "explicit-targeted-v1", occurrenceKey: lineage.occurrenceKey, resources: lineage.resources };
        const pronunciation = { target: lineage.pronunciation, choices: q.choiceVocabEntryIds.map(() => lineage.pronunciation) };
        const itemHash = await scalar<string>("select private.reviewed_exam_sha256_v1($1::jsonb) value", [{ ...q, versionId: command.versionId, proof, pronunciation }]);
        await db.query(`insert into private.vocabulary_composition_items(version_id,dataset_id,vocab_entry_id,item_id,item_sha256,quiz_mode,direction,source_kind,prompt_role,choice_role,prompt,choice_texts,choice_vocab_entry_ids,correct_choice_index,pronunciation_snapshot,source_proof)
          values($1,$2,$3,$4,$4,'book_meaning_choice','english_to_korean','generated_meaning','headword','korean_meaning',$5,$6,$7,0,$8,$9)`, [command.versionId, prep.datasetId, q.vocabEntryId, itemHash, q.prompt, q.choices, q.choiceVocabEntryIds, pronunciation, proof]);
      }
      await db.query(`update private.vocabulary_compositions set state='ready',question_sha256=(select private.reviewed_exam_sha256_v1(coalesce(jsonb_agg(item_sha256 order by item_id),'[]')) from private.vocabulary_composition_items where version_id=$1) where version_id=$1`, [command.versionId]);
      await db.query("update public.vocab_datasets set status='ready' where id=$1", [prep.datasetId]);
      await db.query("update public.vocab_dataset_catalog set is_assignable=true where dataset_id=$1", [prep.datasetId]);
    } else {
      await service();
      for (let n = 0; n < 6; n++) {
        const state = compositionStepSchema.parse(await scalar("select public.advance_vocabulary_composition_questions_v1($1,$2,$3::jsonb) value", [command.versionId, command.contentHash, n === 0 ? questions : null]));
        if (state.state === "ready") break;
        if (n === 5) throw Error("fake question preparation did not finish");
      }
    }
    const units = [...new Set(prep.entries.map(e => e.unitId))];
    await admin();
    const items = (await db.query<{ vocab_entry_id: number; question_item_id: string; question_item_sha256: string }>("select * from public.list_active_vocabulary_composition_questions_v1($1,$2::uuid[],'book_meaning_choice')", [prep.datasetId, units])).rows;
    expect(items).toHaveLength(4);
    return { datasetId: prep.datasetId, units, direction, plan: items.map((q, index) => ({ vocab_entry_id: q.vocab_entry_id, base_order_index: index + 1, direction,
      composition_bank: { mode: "book_meaning_choice", version_id: command.versionId, content_sha256: command.contentHash, question_item_id: q.question_item_id, question_item_sha256: q.question_item_sha256 } })) };
  }
  async function create(book: Book) {
    await admin();
    return scalar<string>("select public.create_assignment_with_delivery_v7('가짜 저장 검사',$1::uuid,$2::uuid[],4,$3::smallint,300,80::smallint,true,80::smallint,'fixed',null,array[$4::uuid],'none',null,$5::jsonb) value", [book.datasetId, book.units, book.direction === "english_to_korean" ? 100 : 0, studentId, book.plan]);
  }
  async function contents(id: string) {
    await owner();
    return scalar("select jsonb_agg(to_jsonb(q)-array['id','assignment_id','created_at'] order by base_order_index) value from private.assignment_question_contents_v1 q where assignment_id=$1", [id]);
  }
  async function attributes() {
    await owner();
    return scalar(`select jsonb_build_object(
      'functions',(select jsonb_agg(jsonb_build_object('oid',oid,'owner',proowner,'acl',proacl,'config',proconfig,'definer',prosecdef) order by oid)
        from pg_proc where pronamespace='private'::regnamespace and proname in('resolve_assignment_question_content_v1','resolve_quiz_question_content_v1','exam_use_question_binding_v1')),
      'view',(select jsonb_build_object('oid',oid,'owner',relowner,'acl',relacl,'options',reloptions) from pg_class where oid='private.assignment_question_contents_v1'::regclass),
      'columns',(select jsonb_agg(to_jsonb(a) order by attnum) from pg_attribute a where attrelid='public.assignment_questions'::regclass),
      'constraints',(select jsonb_agg(jsonb_build_object('oid',oid,'definition',pg_get_constraintdef(oid)) order by oid) from pg_constraint where conrelid='public.assignment_questions'::regclass)) value`);
  }
  async function snapshot() {
    await owner();
    const tables = ["public.vocab_entries", "private.vocabulary_composition_entries", "private.vocabulary_composition_items", "private.vocabulary_library_scopes", "private.vocabulary_library_scope_rows", "public.assignments", "public.assignment_students", "public.assignment_units", "public.assignment_questions", "private.vocabulary_question_content_versions", "private.assignment_vocabulary_meaning_refs", "private.vocabulary_question_meaning_versions", "public.audit_events", "private.quiz_attempt_preparations", "private.local_quiz_preparations"];
    const result: Record<string, unknown> = {};
    for (const table of tables) result[table] = await scalar(`select coalesce(jsonb_agg(to_jsonb(r) order by to_jsonb(r)::text),'[]') value from ${table} r`);
    return result;
  }
  async function expectFailure(action: () => Promise<unknown>, message: string) {
    await owner(); await db.exec("savepoint expected_failure");
    try { await expect(action()).rejects.toThrow(message); }
    finally { await db.exec("rollback to expected_failure; release expected_failure"); await owner(); }
  }


  async function rpc<T = unknown>(name: string, values: unknown[]) {
    await service();
    return scalar<T>('select public.' + name + '(' + values.map((_, i) => '$' + (i + 1)).join(',') + ') value', values);
  }
  async function start(assignment: string) {
    const prepared = await rpc<{ preparationId: string; planHash: string }>('prepare_local_quiz_v1', [studentId, assignment, device, null]);
    return localPhasePlanSchema.parse(await rpc('begin_local_quiz_v1', [studentId, prepared.preparationId, device, prepared.planHash]));
  }
  async function finish(plan: LocalPhasePlan, wrong: number) {
    const batch: LocalBatch = { submissionId: randomUUID(), attemptId: plan.attemptId, phase: plan.phase, planHash: plan.planHash,
      answers: plan.items.map((q, i) => ({ id: q.id, order: i + 1, kind: 'answer' as const, choice: (q.correctChoiceIndex + (i < wrong ? 1 : 0)) % 4, openedMs: i * 100, elapsedMs: i * 100 })),
      completion: { reason: 'answered', elapsedMs: (plan.items.length - 1) * 100 } };
    await owner();
    const passed = await scalar<number>('select extract(epoch from(clock_timestamp()-$1::timestamptz))*1000 value', [plan.startedAt]);
    await new Promise(resolve => setTimeout(resolve, Math.max(0, batch.completion.elapsedMs - Number(passed) + 30)));
    const submit = () => rpc('submit_local_quiz_phase_v1', [studentId, batch.attemptId, batch.phase, device, batch.planHash, batch.submissionId, batch.answers, batch.completion]);
    const receipt = localReceiptSchema.parse(await submit());
    expect(await receiptConfirmsBatch(batch, receipt)).toBe(true);
    expect(await submit()).toEqual(receipt);
    return { receipt, replay: submit };
  }
  beforeAll(async () => {
    db = await createFinalSchemaDatabase({ beforeMigration: async (database, name) => {
      if (name !== migration) return;
      db = database;
      await db.exec("grant usage on schema auth,extensions to service_role; alter role service_role bypassrls; set time zone 'UTC'");
      await db.exec('insert into auth.users(id) values(\'' + adminId + '\'); insert into public.admin_profiles(user_id,display_name) values(\'' + adminId + '\',\'가짜 확인값 관리자\');' +
        'insert into public.students(id,display_name,created_by,school_name,grade_label) values(\'' + studentId + '\',\'가짜 확인값 학생\',\'' + adminId + '\',\'가상고\',\'고2\');');
      await db.query("select set_config('request.jwt.claims',$1,false)", [JSON.stringify({ ref: project })]);
      standard = await seedBook('normal');
      oldAssignment = await create(standard);
      oldPreparation = await rpc('prepare_local_quiz_v1', [studentId, oldAssignment, device, null]);
      fresh = await seedBook('fresh');
      ambiguous = await seedBook('ambiguous', 'korean_to_english');
      duplicate = await seedBook('duplicate', 'english_to_korean', true);
      previousRows = await snapshot(); previousAttributes = await attributes();
    } });
  }, 90000);
  beforeEach(async () => { await owner(); await db.exec('begin'); });
  afterEach(async () => { await db.exec('rollback'); await owner(); });
  afterAll(async () => { await db?.close(); });

  it('keeps old rows, preparations, columns, constraints and reader identity unchanged', async () => {
    expect(await snapshot()).toEqual(previousRows);
    expect(await attributes()).toEqual(previousAttributes);
    const created = await create(standard);
    expect(await contents(created)).toEqual(await contents(oldAssignment));
    const plan = localPhasePlanSchema.parse(await rpc('begin_local_quiz_v1', [studentId, oldPreparation.preparationId, device, oldPreparation.planHash]));
    expect(plan.items).toHaveLength(4);
    await finish(plan, 0);
  });

  it('writes only shared hashes at INSERT, restores them and preserves meaning links', async () => {
    await db.exec('create temp table write_probe(op text, hashes_empty boolean); create function pg_temp.observe_hashes() returns trigger language plpgsql as $$begin insert into pg_temp.write_probe values(tg_op,new.entry_row_sha256_snapshot is null and new.eligibility_input_hash_snapshot is null);return new;end$$; create trigger observe_hashes after insert or update on public.assignment_questions for each row execute function pg_temp.observe_hashes()');
    const created = await create(standard);
    expect(await contents(created)).toEqual(await contents(oldAssignment));
    expect(await scalar("select jsonb_build_object('inserts',count(*)filter(where op='INSERT'),'updates',count(*)filter(where op='UPDATE'),'duplicates',count(*)filter(where not hashes_empty)) value from pg_temp.write_probe")).toEqual({ inserts: 4, updates: 0, duplicates: 0 });
    expect(await scalar<number>('select count(*)::int value from private.assignment_vocabulary_meaning_refs r join public.assignment_questions q on q.id=r.assignment_question_id where q.assignment_id=$1', [created])).toBe(4);
  });

  it('rejects partial hashes, another content ID, changed identifiers, choices and inline bodies', async () => {
    const created = await create(fresh); await owner();
    const rows = (await db.query<{ id: string; content_version_id: string }>('select id,content_version_id from public.assignment_questions where assignment_id=$1 order by base_order_index', [created])).rows;
    const changes = [{ entry_row_sha256_snapshot: 'A'.repeat(64) }, { eligibility_input_hash_snapshot: 'A'.repeat(64) },
      { content_version_id: rows[1].content_version_id }, { vocab_entry_id: -1 }, { composition_item_id_snapshot: 'f'.repeat(64) },
      { direction: 'korean_to_english' }, { correct_choice_index: 1 }, { choice_vocab_entry_ids: [1, 2, 3, 4] }, { prompt: 'fake' }, { choices: ['fake'] }];
    for (const patch of changes) {
      expect(await scalar<number>("select count(*)::int value from jsonb_object_keys($1::jsonb) k where not exists(select 1 from pg_attribute where attrelid='public.assignment_questions'::regclass and attname=k)", [patch])).toBe(0);
      await expectFailure(() => db.query('select private.resolve_assignment_question_content_v1(jsonb_populate_record(q,$2::jsonb)) from public.assignment_questions q where id=$1', [rows[0].id, patch]), 'question_content_binding_mismatch');
    }
    await expectFailure(() => db.query('update public.assignment_questions set entry_row_sha256_snapshot=repeat(\'A\',64) where id=$1', [rows[0].id]), 'question_content_reference_immutable');
  });

  it('keeps initial, retry and replay valid while quiz readers restore the compact bank', async () => {
    const created = await create(standard), plan = await start(created);
    await owner();
    expect(await scalar<number>('select count(*)::int value from private.quiz_question_contents_v1 q join private.assignment_question_contents_v1 b on b.id=q.assignment_question_id where q.attempt_id=$1 and (q.prompt,q.choices,q.correct_choice_index)=(b.prompt,b.choices,b.correct_choice_index)', [plan.attemptId])).toBe(4);
    const initial = await finish(plan, 2);
    expect(initial.receipt.result).toMatchObject({ state: 'retry_waiting', finalized: false });
    const retry = localPhasePlanSchema.parse(await rpc('begin_local_quiz_retry_v1', [studentId, plan.attemptId, device]));
    expect(retry.items.map(q => ({ id: q.id, contentId: q.contentId }))).toEqual(plan.items.slice(0, 2).map(q => ({ id: q.id, contentId: q.contentId })));
    const final = await finish(retry, 1);
    expect(final.receipt.result).toMatchObject({ state: 'failed', finalized: true, attempt: { finalScore: 75, passed: false } });
    expect(await initial.replay()).toEqual(initial.receipt);
    await owner();
    expect(await scalar<number>('select count(*)::int value from private.vocabulary_answer_receipts where attempt_id=$1', [plan.attemptId])).toBe(6);
    const selection = { mode: 'direct', datasetId: standard.datasetId, reviewLevels: [1, 2] };
    const source = mistakePracticeSourceSchema.parse(await rpc('prepare_book_mistake_assignment_source_v1', [adminId, studentId, selection]));
    expect(source.words).toHaveLength(1);
    const voice = { displayKo: null, variantId: null, audioUrl: null, available: false };
    const questions = source.words.map((word, bankIndex) => ({ ...word.frozenQuestion, wordKey: word.wordKey, meaningKey: word.meaningKey,
      episodeId: word.episodeId, sourceQuestionId: word.sourceQuestionId, sourcePhase: word.sourcePhase, sourceContentHash: word.sourceContentHash,
      pronunciation: voice, choicePronunciations: [voice, voice, voice, voice], choiceSources: [], bankIndex }));
    const batch = { studentId, selection, sourceHash: source.sourceHash, audienceMode: 'single', gradeConfirmed: false,
      settings: { questionCount: 1, englishToKoreanRatio: 100, timingMode: 'none', timeLimitSeconds: null, questionTimeLimitSeconds: null,
        passingScore: 80, retryEnabled: false, retryPassingScore: null, title: '가짜 공용 확인값 오답 시험', questionOrderMode: 'fixed', availableFrom: null, availableUntil: null },
      questions, banks: [{ index: 0, questionCount: 1, englishToKoreanRatio: 100, timeLimitSeconds: null }] };
    const saved = await rpc<{ assignmentId: string }[]>('create_book_mistake_assignments_v1', [adminId, randomUUID(), sha(JSON.stringify(batch)), JSON.stringify([batch])]);
    expect(saved).toHaveLength(1); await owner();
    expect(await scalar<number>(`select count(*)::int value from private.assignment_question_contents_v1 q
      join private.notebook_question_origins_v2 origin on origin.assignment_question_id=q.id
      join public.quiz_questions original on original.id=origin.source_question_id
      join private.assignment_question_contents_v1 bank on bank.id=original.assignment_question_id
      where q.assignment_id=$1 and q.entry_row_sha256_snapshot=bank.entry_row_sha256_snapshot`, [saved[0].assignmentId])).toBe(1);
    await finish(await start(saved[0].assignmentId), 0);
  });

  it('rolls back both original final-bank failures and late failure with no orphan content', async () => {
    for (const [book, code] of [[ambiguous, 'assignment_target_prompt_ambiguous'], [duplicate, 'assignment_target_choices_duplicate']] as const) {
      const before = await snapshot(); await expectFailure(() => create(book), code); expect(await snapshot()).toEqual(before);
    }
    await db.exec('create function pg_temp.fail_late_hash_insert() returns trigger language plpgsql as $$begin if new.base_order_index=4 then raise exception \'fake_late_hash_failure\';end if;return new;end$$;create trigger fail_late_hash_insert after insert on public.assignment_questions for each row execute function pg_temp.fail_late_hash_insert()');
    const before = await snapshot(); await expectFailure(() => create(fresh), 'fake_late_hash_failure'); expect(await snapshot()).toEqual(before);
  });

  it('runs compaction after source guards and freezing and denies direct application execution', async () => {
    const triggers = await scalar<string[]>("select array_agg(tgname::text order by tgname) value from pg_trigger where tgrelid='public.assignment_questions'::regclass and not tgisinternal and tgtype&7=7 and tgenabled='O'");
    const compact = triggers.indexOf('zzzz_compact_composition_assignment_hashes');
    for (const name of ['assignment_composition_identity', 'assignment_reviewed_choices', 'notebook_question_source_guard', 'zz_register_composition_question_content', 'zzz_freeze_assignment_question_content']) {
      expect(triggers.indexOf(name)).toBeGreaterThan(-1); expect(triggers.indexOf(name)).toBeLessThan(compact);
    }
    expect(compact).toBeGreaterThan(-1);
    for (const role of ['anon', 'authenticated', 'service_role']) for (const fn of ['private.compact_composition_assignment_hashes_v1()', 'private.resolve_composition_assignment_hashes_v1(public.assignment_questions)'])
      expect(await scalar('select has_function_privilege($1,$2,\'execute\') value', [role, fn])).toBe(false);
  });

  it('keeps new compact rows outside the historical body migration boundary', async () => {
    const created = await create(standard); await owner();
    await db.query("update public.assignments set status='closed' where id=$1", [created]);
    const rows = await scalar<string[]>('select array_agg(id order by base_order_index) value from public.assignment_questions where assignment_id=$1', [created]);
    const before = await snapshot();
    await expectFailure(() => db.query("select private.prepare_historical_question_batch_v1($1,'assignment',$2::uuid[])", [created, rows]), 'historical_question_already_referenced');
    expect(await snapshot()).toEqual(before);
  });

  it('can roll back new writes by removing just the compaction trigger and retain compact reads', async () => {
    const compact = await create(standard); await owner();
    await db.exec('drop trigger zzzz_compact_composition_assignment_hashes on public.assignment_questions');
    const original = await create(standard);
    expect(await contents(compact)).toEqual(await contents(original));
    expect(await contents(original)).toEqual(await contents(oldAssignment));
    expect(await scalar<number>('select count(*)::int value from public.assignment_questions where assignment_id=$1 and entry_row_sha256_snapshot is not null and eligibility_input_hash_snapshot is not null', [original])).toBe(4);
    await finish(await start(compact), 0); await finish(await start(original), 0);
  });
});
