import { createHash, randomUUID } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { PGlite } from "@electric-sql/pglite";
import { beforeAll, afterAll, describe, it, expect, vi } from "vitest";
import { createFinalSchemaDatabase } from "@/test-support/final-schema-database";
import { EMPTY_LIBRARY_FILTERS, libraryCatalogSchema, libraryCommandResultSchema, type LibraryTemplate } from "@/features/wordbook-compositions/contracts/library";
import { compositionPreparationSchema, type CompositionPreparation } from "@/features/wordbook-compositions/contracts/library-materialization";
import { planCompositionQuestions } from "@/features/wordbook-compositions/server/use-cases/composition-question-plan";
import { computeExamUseEntryContentHash, computeExamUsePackageVersion } from "@/lib/vocab/exam-use-import-contract";
import { saveHistoricalLearningArchive, loadHistoricalLearningArchive } from "../../../scripts/historical-learning-archive";
vi.mock("server-only", () => ({}));

const adminId = "a8040000-0000-4000-8000-000000000001", studentId = "a8040000-0000-4000-8000-000000000002";
const hash = (s: string) => createHash("sha256").update(s).digest("hex");
const selected = (n: number) => ({
  schemaVersion: "vocabulary-resource-snapshot-v1", sourceFields: { raw: `Original source ${n}` }, proofs: {},
  pronunciation: { displayKo: `고정발음${n}`, segments: [{ text: `고정발음${n}`, stress: "primary" }],
    variantId: `fake-${n}`, audioUrl: `https://media.merriam-webster.com/audio/prons/en/us/mp3/a/fake${n}.mp3`, available: true },
  lexicalPos: "noun", dictionary: n % 2 ? { dictionary_id: `frozen-${n}`, payload: { raw: "large old dictionary".repeat(100) } } : null,
  senseId: null, definitionEn: ` Frozen definition ${n} `, exampleEn: ` Frozen example ${n} `, exampleKo: null,
});
type Packet = { id: string; beforeText: string };
describe.sequential("historical learning sources: real old import, fixed versions and partial restore", () => {
  let db: PGlite, template: LibraryTemplate, pendingTemplate: LibraryTemplate, prepared: CompositionPreparation;
  let scopeId: string, pendingScope: string, assignmentId: string, sourceDataset: string;
  let originalRows: unknown, originalPreserved: unknown, originalMeanings: unknown, originalReading: unknown;
  let beforeNewBook: unknown;
  let examBook: CompositionPreparation, examScope: string;
  let pendingCommand: Record<string, unknown>;
  let scopePackets: Packet[], compositionPackets: Packet[];
  const archiveDirectory = fs.mkdtempSync(path.join(os.tmpdir(), "historical-learning-"));
  const scalar = async <T>(sql: string, args: unknown[] = []) => (await db.query<{ value: T }>(sql, args)).rows[0]!.value;
  const owner = () => db.exec("reset role; set statement_timeout='30s'; set lock_timeout='1s';");
  const admin = () => db.exec(`reset role; set role authenticated; select set_config('request.jwt.claim.sub','${adminId}',false); select set_config('request.jwt.claim.role','authenticated',false);`);
  const service = () => db.exec("reset role; set role service_role; select set_config('request.jwt.claim.role','service_role',false);");
  const prepare = (kind: string, group: string, keys: string[]) => scalar<Packet[]>("select private.prepare_historical_learning_batch_v1($1,$2,$3::text[]) value", [kind, group, keys]);
  const apply = (packets: Packet[], action = "compact", requestId = randomUUID()) => {
    const saved = saveHistoricalLearningArchive(archiveDirectory, { schemaVersion: "historical-learning-archive-v1", origin: "local-synthetic", packets });
    const file = loadHistoricalLearningArchive(saved.path, saved.sha256);
    return scalar<{ changed: number }>("select private.apply_historical_learning_batch_v1($1,$2,$3,$4::jsonb) value",
      [requestId, action, file.parameters.p_archive_sha256, JSON.stringify(file.parameters.p_rows)]);
  };
  const keysFor = (scope: string) => scalar<string[]>("select jsonb_agg(occurrence_key order by source_row) value from private.vocabulary_library_scope_rows where scope_id=$1", [scope]);
  const rows = () => scalar(`select jsonb_build_object('scope',(select jsonb_agg(to_jsonb(r) order by source_row) from private.vocabulary_library_scope_rows r where scope_id=$1),
    'composition',(select jsonb_agg(to_jsonb(r) order by vocab_entry_id) from private.vocabulary_composition_entries r where version_id=$2)) value`, [scopeId, prepared.versionId]);
  const preserved = () => scalar(`select jsonb_build_object(
    'versions',(select jsonb_agg(to_jsonb(v) order by id) from private.vocabulary_library_versions v),
    'fingerprints',(select jsonb_agg(to_jsonb(f) order by scope_id,occurrence_key) from private.vocabulary_library_row_fingerprints f),
    'parents',(select jsonb_agg(to_jsonb(c) order by version_id) from private.vocabulary_compositions c),
    'items',(select jsonb_agg(to_jsonb(i) order by version_id,item_id) from private.vocabulary_composition_items i),
    'entries',(select jsonb_agg(to_jsonb(e) order by id) from public.vocab_entries e),
    'questions',(select jsonb_agg(to_jsonb(q) order by id) from public.assignment_questions q),
    'assignments',(select jsonb_agg(to_jsonb(a) order by id) from public.assignments a),
    'builds',(select jsonb_agg(to_jsonb(b) order by version_id) from private.vocabulary_composition_builds b)) value`);
  const meanings = () => scalar("select jsonb_agg(private.assignment_vocabulary_meaning_v1(id) order by base_order_index) value from public.assignment_questions where assignment_id=$1", [assignmentId]);
  const reading = () => scalar(`select jsonb_agg(jsonb_build_object('entry',case when e.resources#>>'{selected,schemaVersion}'='vocabulary-resource-ref-v2'
      then private.resolve_vocabulary_learning_value_v1(e.resources->'selected')->'entryValues'
      else private.project_vocabulary_learning_value_v1(e.source_snapshot->'entry',e.resources->'selected')->'entryValues' end,
    'selected',(private.vocabulary_composition_resource_v1(e.resources))-array['schemaVersion','dictionary','senseId','proofs','sourceFields']) order by e.vocab_entry_id) value
    from private.vocabulary_composition_entries e where version_id=$1`, [prepared.versionId]);
  async function newBookEvidence(book = prepared) {
    await admin();
    const copied = libraryCommandResultSchema.parse(await scalar("select public.save_vocabulary_library_template_v1($1::jsonb) value", [JSON.stringify({
      action: "copy", requestId: randomUUID(), sourceVersionId: book.versionId,
      metadata: { title: "가짜 이전 뒤 복사", tags: [], school: null, targetGrade: null, schoolYear: null, semester: null, assessment: null, purpose: null },
    })])).template.versions[0]!;
    expect(copied.contentHash).toBe(book.contentHash);
    const newBook = compositionPreparationSchema.parse(await scalar("select public.prepare_vocabulary_composition_v1($1,$2) value", [copied.id, copied.contentHash]));
    expect(newBook.entries.map(e => [e.headword, e.primaryMeaning, e.resources.pronunciation])).toEqual(book.entries.map(e => [e.headword, e.primaryMeaning, e.resources.pronunciation]));
    await service(); await scalar("select public.finalize_vocabulary_composition_summary_v1($1,$2,$3::jsonb) value", [copied.id, copied.contentHash, JSON.stringify(planCompositionQuestions(newBook))]);
    await admin();
    const units = await scalar<string[]>("select jsonb_agg(id order by sort_index) value from public.vocab_units where dataset_id=$1", [newBook.datasetId]);
    const bank = (await db.query<{ vocab_entry_id: number; direction: string; question_item_id: string; question_item_sha256: string }>(
      "select * from public.list_active_vocabulary_composition_questions_v1($1,$2::uuid[],'book_meaning_choice')", [newBook.datasetId, units])).rows.filter(q => q.direction === "english_to_korean");
    const qs = bank.map((q, n) => ({ vocab_entry_id: q.vocab_entry_id, base_order_index: n + 1, direction: q.direction,
      composition_bank: { mode: "book_meaning_choice", version_id: copied.id, content_sha256: copied.contentHash, question_item_id: q.question_item_id, question_item_sha256: q.question_item_sha256 } }));
    const aid = await scalar<string>(`select public.create_assignment_with_delivery_v7('가짜 신규 시험',$1::uuid,$2::uuid[],6,100::smallint,300,80::smallint,false,null,'fixed',null,array['${studentId}']::uuid[],'none',null,$3::jsonb) value`, [newBook.datasetId, units, JSON.stringify(qs)]);
    await owner();
    return scalar(`select jsonb_build_object('bindings',(select jsonb_agg(private.resolve_vocabulary_learning_binding_v1(c.resources) order by e.source_row)
      from private.vocabulary_composition_entries c join public.vocab_entries e on e.id=c.vocab_entry_id where c.version_id=$1),
      'meanings',(select jsonb_agg(private.assignment_vocabulary_meaning_v1(q.id) order by e.source_row) from public.assignment_questions q
        join public.vocab_entries e on e.id=q.vocab_entry_id where q.assignment_id=$2)) value`, [copied.id, aid]);
  }
  async function importTemplate(count: number, suffix: string) {
    await owner();
    const dataset = await scalar<string>(`insert into public.vocab_datasets(dataset_key,title,source_label,source_sha256,row_count,status,is_active)
      values($1,'가짜 이전 자료','fake',repeat('A',64),$2,'ready',true) returning id value`, [`historical-learning-${suffix}`, count]);
    const unit = await scalar<string>(`insert into public.vocab_units(dataset_id,unit_label,normalized_label,unit_kind,unit_number,sort_index,entry_count)
      values($1,'DAY 1','day1','day',1,1,$2) returning id value`, [dataset, count]);
    await db.query("insert into public.vocab_dataset_catalog(dataset_id,display_name,catalog_group,material_kind) values($1,'가짜 자료','high','wordbook')", [dataset]);
    await db.query(`insert into public.vocab_entries(dataset_id,source_row,headword,headword_normalized,meanings,primary_meaning,row_sha256,unit_id,position_in_unit,entry_type,pronunciation_ko,english_definition,example_en,example_ko,source_ref)
      select $1,n,'frozenword'||n,'frozenword'||n,array['옛 뜻 '||n,'부가 뜻'],'옛 뜻 '||n,upper(encode(extensions.digest('learning:'||n,'sha256'),'hex')),$2,n,'word',
      '원발음'||n,'Original entry definition '||n,'Original entry example '||n,null,'source:'||n from generate_series(1,$3::int)n`, [dataset, unit, count]);
    await db.query(`insert into public.vocab_entry_quiz_eligibility(vocab_entry_id,dataset_id,quiz_mode,status,input_content_hash,rule_version,evaluated_at_utc)
      select e.id,e.dataset_id,m,'eligible',e.row_sha256,'fake',now() from public.vocab_entries e cross join unnest(array['book_meaning_en_to_ko','book_meaning_ko_to_en'])m where e.dataset_id=$1`, [dataset]);
    const sourceRows = (await db.query<{ source_row: number; row_hash: string }>("select source_row,lower(row_sha256) row_hash from public.vocab_entries where dataset_id=$1 order by source_row", [dataset])).rows;
    const bundle = { schemaVersion: "vocabulary-library-import-v1", sourceCatalogHash: hash("catalog"), linksHash: hash("links"), referenceCatalogHash: hash("refs"), scopes: [{
      key: `historical-${suffix}`, name: "가짜 이전 범위", sourceTitle: "가짜 이전 자료",
      source: { datasetId: dataset, unitId: unit, kind: "legacy_vocab", releaseId: null, releaseVersion: "a".repeat(64), fileHash: hash("fake"), locator: "fake-original.json" },
      classification: { kind: "wordbook", sourceGrade: "g11", exam: null, lesson: null, day: 1, publisher: null, school: null, targetGrade: null, schoolYear: null, semester: null, assessment: null, purpose: null },
      rows: sourceRows.map(r => ({ sourceRow: r.source_row, rowHash: r.row_hash, resources: { entryHash: r.row_hash, linkRecordHash: hash(`row:${r.source_row}`), selected: selected(r.source_row) } })),
    }] };
    const input = JSON.stringify(bundle), contentHash = await scalar<string>("select private.reviewed_exam_sha256_v1($1::jsonb) value", [input]);
    await db.query("insert into private.vocabulary_library_import_approvals values('wojxpruvbjzbhrpmsbuy',$1,$2,1,'fake-history')", [hash(input), contentHash]);
    await service(); await db.query("select public.import_vocabulary_library_v1($1)", [input]); await admin();
    const scope = libraryCatalogSchema.parse(await scalar("select public.list_vocabulary_library_v1() value")).scopes.find(s => s.source.datasetId === dataset)!;
    const t = libraryCommandResultSchema.parse(await scalar("select public.save_vocabulary_library_template_v1($1::jsonb) value", [JSON.stringify({ action: "create", requestId: randomUUID(),
      metadata: { title: "가짜 이전 단어장", tags: [], school: null, targetGrade: null, schoolYear: null, semester: null, assessment: null, purpose: null },
      recipe: { filters: EMPTY_LIBRARY_FILTERS, scopes: [{ id: scope.id, version: scope.version }], excludedOccurrenceKeys: [], scopeStatus: "confirmed" } })])).template;
    return { dataset, scopeId: scope.id, template: t };
  }
  async function importExamTemplate() {
    const entries = Array.from({ length: 6 }, (_, i) => {
      const n = i + 1;
      const e: Record<string, unknown> = {
        source_row: n, sequence_no: n, unit: "2025-01 장문독해", day: null, position_in_unit: n,
        dictionary_id: `word:occurrence-dictionary-${n}`, legacy_ids: [], sense_id: null,
        pronunciation_variant_id: `mw:fake-${n}`, display_headword: `examfake${n}`, display_gloss_ko: `옛 모의고사 뜻 ${n}`,
        display_pronunciation_ko: `가짜 ${n}`, display_pronunciation_review_status: "candidate",
        audio: { status: "raw_attached", audio_url: `https://media.merriam-webster.com/audio/prons/en/us/mp3/f/fake${n}.mp3`,
          sound_audio: `fake${n}`, raw_response_sha256: hash("raw"), raw_source: "api_raw", raw_relative_path: `fake-${n}.json`, reason: null,
          selection_status: "single_exact_raw_variant", source_locator: `fake-${n}`, variant_id: `mw:fake-${n}`, variant_pos: "noun", mw_notation: `fake-${n}` },
        occurrence_id: `occ:historical-${n}`, occurrence_content_hash: hash(`occ:${n}`), content_hash: hash("placeholder"),
        exam_review_id: `exam-review:historical-${n}`, exam_input_hash: hash(`input:${n}`), exam_use_status: "reviewed_for_preview",
        context_evidence_status: "source_entry_context", context_evidence: { source: "source_entries", source_entry_id: `source-${n}`, source_entry_sha256: hash(`source:${n}`) },
        entry_row_sha256: hash(`exam-row:${n}`).toUpperCase(), source_entry_id: `source-${n}`, source_entry_sha256: hash(`source:${n}`),
        include_in_exam: true, manual_review_flags: [],
      };
      e.content_hash = computeExamUseEntryContentHash(e); return e;
    });
    const pack: Record<string, unknown> = { schema_version: "1.0", package_type: "student-app-exam-use-wordbook", target_environment: "preview",
      common_dictionary_release_allowed: false, exam_use_import_allowed: true, package_version: hash("placeholder"), dataset_key: "historical-exam-fake",
      source_sha256: hash("source"), candidate_dictionary_version: hash("dictionary"), manifest_content_hash: hash("manifest"),
      exam_review_ledger_sha256: hash("review"), wordbook_id: "historical-exam-fake", title: "가짜 모의고사 이전", generated_at_utc: "2026-08-07T00:00:00Z", entries };
    pack.package_version = computeExamUsePackageVersion(pack);
    await service();
    const imported = await scalar<{ datasetId: string; releaseId: string }>("select public.import_app_exam_use_package_v1($1::jsonb) value", [JSON.stringify(pack)]);
    await owner();
    await db.query("insert into public.vocab_dataset_catalog(dataset_id,display_name,catalog_group,material_kind,grade_code) values($1,'가짜 모의고사','high_mock','wordbook','g12')", [imported.datasetId]);
    const unit = await scalar<string>("select id value from public.vocab_units where dataset_id=$1", [imported.datasetId]);
    const sourceRows = (await db.query<{ source_row: number; row_hash: string }>("select source_row,lower(row_sha256) row_hash from public.vocab_entries where dataset_id=$1 order by source_row", [imported.datasetId])).rows;
    const bundle = { schemaVersion: "vocabulary-library-import-v1", sourceCatalogHash: hash("catalog"), linksHash: hash("links"), referenceCatalogHash: hash("refs"), scopes: [{
      key: "historical-exam-fake", name: "가짜 모의고사 범위", sourceTitle: "가짜 원고",
      source: { datasetId: imported.datasetId, unitId: unit, kind: "exam_use", releaseId: imported.releaseId, releaseVersion: pack.package_version, fileHash: hash("exam-file"), locator: "fake-exam.json" },
      classification: { kind: "mock", sourceGrade: "g12", exam: { executionYear: 2025, examMonth: 9, examKind: "mock", academicYear: null, agency: "가짜", typeCode: "long", typeLabel: "장문독해", questionNumbers: [41, 42], sharedPassage: true },
        lesson: null, day: null, publisher: null, school: null, targetGrade: null, schoolYear: null, semester: null, assessment: null, purpose: null },
      rows: sourceRows.map(r => ({ sourceRow: r.source_row, rowHash: r.row_hash, resources: { entryHash: r.row_hash, linkRecordHash: hash(`exam:${r.source_row}`), selected: selected(r.source_row) } })),
    }] };
    const input = JSON.stringify(bundle);
    await db.query("insert into private.vocabulary_library_import_approvals values('wojxpruvbjzbhrpmsbuy',$1,private.reviewed_exam_sha256_v1($2::jsonb),1,'fake-historical-exam')", [hash(input), input]);
    await service(); await db.query("select public.import_vocabulary_library_v1($1)", [input]); await admin();
    const scope = libraryCatalogSchema.parse(await scalar("select public.list_vocabulary_library_v1() value")).scopes.find(s => s.source.datasetId === imported.datasetId)!;
    const t = libraryCommandResultSchema.parse(await scalar("select public.save_vocabulary_library_template_v1($1::jsonb) value", [JSON.stringify({ action: "create", requestId: randomUUID(),
      metadata: { title: "가짜 모의고사 책", tags: [], school: null, targetGrade: null, schoolYear: null, semester: null, assessment: null, purpose: null },
      recipe: { filters: EMPTY_LIBRARY_FILTERS, scopes: [{ id: scope.id, version: scope.version }], excludedOccurrenceKeys: [], scopeStatus: "confirmed" } })])).template;
    const v = t.versions[0]!;
    const book = compositionPreparationSchema.parse(await scalar("select public.prepare_vocabulary_composition_v1($1,$2) value", [v.id, v.contentHash]));
    await service(); await scalar("select public.finalize_vocabulary_composition_summary_v1($1,$2,$3::jsonb) value", [v.id, v.contentHash, JSON.stringify(planCompositionQuestions(book))]);
    await owner();
    await db.query(`insert into word_index.mock_wordbook_identity_review(source_release_id,source_entry_id,source_row_sha256,reviewed_headword,reviewed_gloss,lexical_pos,sense_id,review_evidence_sha256)
      select $2,id,row_sha256,headword,primary_meaning,'noun','historical-reviewed-sense',repeat('d',64) from public.vocab_entries where dataset_id=$1 and source_row=1`, [imported.datasetId, imported.releaseId]);
    return { book, scope: scope.id };
  }
  beforeAll(async () => {
    db = await createFinalSchemaDatabase({ beforeMigration: async (database, name) => {
      if (name !== "20261001132340_compact_vocabulary_learning_values.sql") return;
      db = database;
      await db.exec(`insert into auth.users(id) values('${adminId}'); insert into public.admin_profiles(user_id,display_name) values('${adminId}','가짜 관리자');
        insert into public.students(id,display_name,created_by,school_name,grade_label) values('${studentId}','가짜 학생','${adminId}','가짜 고등학교','고2');
        select set_config('request.jwt.claims','{"ref":"wojxpruvbjzbhrpmsbuy"}',false);`);
      const ready = await importTemplate(6, "ready"); template = ready.template; scopeId = ready.scopeId; sourceDataset = ready.dataset;
      const v = template.versions[0]!;
      prepared = compositionPreparationSchema.parse(await scalar("select public.prepare_vocabulary_composition_v1($1,$2) value", [v.id, v.contentHash]));
      await service(); await scalar("select public.finalize_vocabulary_composition_summary_v1($1,$2,$3::jsonb) value", [v.id, v.contentHash, JSON.stringify(planCompositionQuestions(prepared))]);
      await admin();
      const units = await scalar<string[]>("select jsonb_agg(id order by sort_index) value from public.vocab_units where dataset_id=$1", [prepared.datasetId]);
      const bank = (await db.query<{ vocab_entry_id: number; direction: string; question_item_id: string; question_item_sha256: string }>(
        "select * from public.list_active_vocabulary_composition_questions_v1($1,$2::uuid[],'book_meaning_choice')", [prepared.datasetId, units])).rows.filter(q => q.direction === "english_to_korean");
      const questions = bank.map((q, n) => ({ vocab_entry_id: q.vocab_entry_id, base_order_index: n + 1, direction: q.direction,
        composition_bank: { mode: "book_meaning_choice", version_id: v.id, content_sha256: v.contentHash, question_item_id: q.question_item_id, question_item_sha256: q.question_item_sha256 } }));
      assignmentId = await scalar<string>(`select public.create_assignment_with_delivery_v7('가짜 과거 시험',$1::uuid,$2::uuid[],6,100::smallint,300,80::smallint,false,null,'fixed',null,array['${studentId}']::uuid[],'none',null,$3::jsonb) value`, [prepared.datasetId, units, JSON.stringify(questions)]);
      await owner(); await db.query("update public.assignments set status='closed' where id=$1", [assignmentId]);
      const pending = await importTemplate(501, "pending"); pendingTemplate = pending.template; pendingScope = pending.scopeId;
      const pv = pendingTemplate.versions[0]!;
      pendingCommand = { action: "materialize", requestId: randomUUID(), templateId: pendingTemplate.id, versionId: pv.id, contentHash: pv.contentHash };
      await scalar("select public.advance_vocabulary_template_book_v1($1::jsonb) value", [JSON.stringify(pendingCommand)]);
      const exam = await importExamTemplate(); examBook = exam.book; examScope = exam.scope;
      await owner();
    } });
    await owner();
    const bridgeBuild = randomUUID(), bridgeSource = randomUUID(), lexeme = randomUUID(), occurrence = randomUUID();
    await db.query(`insert into word_index.index_build(build_id,schema_version,builder_version,source_root_label,input_file_count,input_snapshot_sha256,started_at_utc,completed_at_utc,status,summary_json)
      values($1,'fixture','fixture','fake',1,repeat('B',64),now(),now(),'complete','{}')`, [bridgeBuild]);
    await db.query("insert into word_index.source(source_id,source_key,source_type,title,source_sha256,status) values($1,'historical-learning-bridge','wordbook','Fake source',repeat('E',64),'ready')", [bridgeSource]);
    await db.query("insert into word_index.dataset_source(dataset_id,source_id,build_id,source_role,dataset_source_sha256) values($1,$2,$3,'primary',repeat('A',64))", [sourceDataset, bridgeSource, bridgeBuild]);
    await db.query(`insert into word_index.lexeme(lexeme_id,identity_key,entity_key,origin_bucket,headword,normalized_headword,lexeme_type,type_status,intended_use,lifecycle_status,source_note_path,source_note_sha256,content_hash,created_at_utc,updated_at_utc)
      values($1,'learning-identity','learning-entity','fixture','frozenword2','frozenword2','word','confirmed','quiz','active','fake.md',repeat('A',64),repeat('B',64),now(),now())`, [lexeme]);
    await db.query(`insert into word_index.occurrence(occurrence_id,lexeme_id,source_id,locator_status,priority_tier,priority_reason,mapping_status,source_label_raw)
      values($1,$2,$3,'fixture','fixture','fixture','approved','fixture')`, [occurrence, lexeme, bridgeSource]);
    await db.query(`insert into word_index.vocab_entry_link(vocab_entry_id,dataset_id,entry_row_sha256,source_id,lexeme_id,occurrence_id,canonical_content_hash,mapping_status,mapping_method,mapping_rule_version,candidate_count,evidence,mapped_at_utc,reviewed_at_utc)
      select id,dataset_id,row_sha256,$2,$3,$4,repeat('B',64),'approved','fixture','fixture',1,'{}',now(),now() from public.vocab_entries where dataset_id=$1 and source_row=2`, [sourceDataset, bridgeSource, lexeme, occurrence]);
    await db.exec("begin"); try { beforeNewBook = await newBookEvidence(); } finally { await db.exec("rollback"); await owner(); }
    originalRows = await rows(); originalPreserved = await preserved(); originalMeanings = await meanings(); originalReading = await reading();
  }, 120_000);
  afterAll(async () => { await db?.close(); });
  it("starts from actual pre-M01 imports and a ready bank, and rejects the interrupted 501-row build", async () => {
    expect(await scalar("select count(*)::int value from private.vocabulary_composition_storage_formats")).toBe(0);
    expect(await scalar("select count(*)::int value from private.vocabulary_composition_entries where version_id=$1", [pendingTemplate.versions[0]!.id])).toBe(500);
    await expect(prepare("scope", pendingScope, (await keysFor(pendingScope)).slice(0, 1))).rejects.toThrow("historical_learning_build_pending");
    expect(await scalar("select count(*)::int value from private.historical_learning_migrations")).toBe(0);
  });
  it("prepares shared values without modifying old rows, and keeps all fixed versions and fingerprints", async () => {
    scopePackets = await prepare("scope", scopeId, await keysFor(scopeId));
    compositionPackets = await prepare("composition", prepared.versionId, await keysFor(scopeId));
    expect(await rows()).toEqual(originalRows); expect(await preserved()).toEqual(originalPreserved);
    expect(await prepare("scope", scopeId, await keysFor(scopeId))).toEqual(scopePackets);
    expect(await scalar("select count(*)::int value from private.vocabulary_learning_value_versions")).toBe(6);
  });
  it("compacts separate small batches with frozen reading, old meanings and exact file replay", async () => {
    expect((await apply(scopePackets.slice(0, 2))).changed).toBe(2);
    expect((await apply(scopePackets.slice(2))).changed).toBe(4);
    expect((await apply(compositionPackets)).changed).toBe(6);
    expect(await reading()).toEqual(originalReading); expect(await meanings()).toEqual(originalMeanings); expect(await preserved()).toEqual(originalPreserved);
    await db.query("select private.assert_vocabulary_library_version_current_v1(v) from private.vocabulary_library_versions v where id=$1", [prepared.versionId]);
    const file = saveHistoricalLearningArchive(archiveDirectory, { schemaVersion: "historical-learning-archive-v1", origin: "local-synthetic", packets: compositionPackets });
    const args = [randomUUID(), "compact", file.sha256, JSON.stringify(file.parameters.p_rows)];
    const first = await scalar("select private.apply_historical_learning_batch_v1($1,$2,$3,$4::jsonb) value", args);
    expect(await scalar("select private.apply_historical_learning_batch_v1($1,$2,$3,$4::jsonb) value", args)).toEqual(first);
    await expect(scalar("select private.apply_historical_learning_batch_v1($1,$2,$3,$4::jsonb) value", [args[0], "restore", file.sha256, args[3]])).rejects.toThrow("historical_learning_request_reused");
  });
  it("rejects direct writes, forged archives, duplicated UUID spelling and unsafe transaction settings", async () => {
    await expect(db.query("update private.vocabulary_library_scope_rows set resources='{}' where scope_id=$1", [scopeId])).rejects.toThrow("mock_wordbook_history_is_immutable");
    const forged = [{ ...compositionPackets[0]!, beforeText: "{}" }];
    await expect(apply(forged, "restore")).rejects.toThrow("historical_learning_archive_changed");
    const dup = [scopePackets[0]!, { ...scopePackets[0]!, id: scopePackets[0]!.id.toUpperCase() }];
    await expect(scalar("select private.apply_historical_learning_batch_v1($1,'restore',$2,$3::jsonb) value", [randomUUID(), hash("fake"), JSON.stringify(dup)])).rejects.toThrow("historical_learning_batch_invalid");
    await db.exec("set statement_timeout=0"); await expect(prepare("scope", scopeId, await keysFor(scopeId))).rejects.toThrow("transaction_limits_required"); await owner();
    for (const role of ["anon", "authenticated", "service_role"]) {
      await db.exec(`set role ${role}`);
      await expect(db.query("select private.prepare_historical_learning_batch_v1('scope',$1,$2::text[])", [scopeId, await Promise.resolve(["a".repeat(64)])])).rejects.toThrow(/permission denied/);
      await owner();
    }
  });
  it("protects mixed-source assignments and replays a completed request after new student work exists", async () => {
    const file = saveHistoricalLearningArchive(archiveDirectory, { schemaVersion: "historical-learning-archive-v1", origin: "local-synthetic", packets: compositionPackets });
    const args = [randomUUID(), "compact", file.sha256, JSON.stringify(file.parameters.p_rows)];
    const receipt = await scalar("select private.apply_historical_learning_batch_v1($1,$2,$3,$4::jsonb) value", args);
    await db.exec("begin");
    try {
      // A mixed notebook can have a different representative dataset and no
      // composition version on its questions. Its source relation still protects it.
      const mixed = await scalar<string>(`insert into public.assignments select (jsonb_populate_record(null::public.assignments,
        to_jsonb(a)||jsonb_build_object('id',gen_random_uuid(),'dataset_id',$2::uuid,'status','active'))).* from public.assignments a where id=$1 returning id value`, [assignmentId, sourceDataset]);
      await db.query("insert into public.assignment_sources(assignment_id,dataset_id) values($1,$2)", [mixed, prepared.datasetId]);
      await expect(scalar("select private.lock_historical_learning_batch_v1('composition',$1,$2::text[],true) value", [prepared.versionId, await keysFor(scopeId)])).rejects.toThrow("student_work_pending");
    } finally { await db.exec("rollback"); }
    await db.exec("begin");
    try {
      await db.query("update public.assignments set status='active' where id=$1", [assignmentId]);
      expect(await scalar("select private.apply_historical_learning_batch_v1($1,$2,$3,$4::jsonb) value", args)).toEqual(receipt);
      await expect(apply(compositionPackets)).rejects.toThrow("student_work_pending");
    } finally { await db.exec("rollback"); }
  });
  it("expands an unchanged fixed version and creates a new ready book from mixed representations", async () => {
    await db.exec("begin");
    try {
      expect(await newBookEvidence()).toEqual(beforeNewBook);
    } finally { await db.exec("rollback"); await owner(); }
  });
  it("does not adopt a current dictionary ID or reviewed identity when projecting frozen evidence", async () => {
    const frozen = await scalar<{ sourceIdentifiers: { dictionaryId: string; legacyLexemeId: null }; selectedDictionary: { dictionary_id: string }; learningIdentity: { kind: string } }>(
      `select private.project_historical_learning_binding_v1(r.entry_snapshot,
       '{"dictionary_id":"original-occurrence-id","legacy_ids":[],"occurrence_id":"old-row","sense_id":"old-sense"}'::jsonb,
       (r.resources||jsonb_build_object('selected',$2::jsonb)),
       jsonb_build_object('kind','exam_use','datasetId',s.dataset_id,'unitId',s.unit_id,'releaseId',gen_random_uuid(),'version',s.source_version,
         'fileHash',s.source_file_sha256,'locator','frozen.json','sourceRow',r.source_row,'occurrenceKey',r.occurrence_key,'state',r.state),repeat('a',64)) value
       from private.vocabulary_library_scope_rows r join private.vocabulary_library_scopes s on s.id=r.scope_id where scope_id=$1 and source_row=1`,
      [pendingScope, JSON.stringify(selected(1))]);
    expect(frozen.sourceIdentifiers.dictionaryId).toBe("original-occurrence-id");
    expect(frozen.sourceIdentifiers.legacyLexemeId).toBeNull();
    expect(frozen.selectedDictionary.dictionary_id).toBe("frozen-1");
    expect(frozen.learningIdentity.kind).toBe("source-occurrence-v1");
  });
  it("preserves separately reviewed exam meanings for new creation while historical migration stays frozen", async () => {
    let before: unknown;
    await db.exec("begin"); try { before = await newBookEvidence(examBook); } finally { await db.exec("rollback"); await owner(); }
    await db.exec("begin");
    try {
      const packets = await prepare("scope", examScope, await keysFor(examScope));
      await apply(packets);
      expect(await scalar("select count(*)::int value from private.vocabulary_learning_value_bindings where payload#>>'{source,datasetId}'=(select dataset_id::text from private.vocabulary_library_scopes where id=$1) and payload#>>'{learningIdentity,kind}'='reviewed-meaning-v1'", [examScope])).toBe(0);
      const after = await newBookEvidence(examBook);
      expect(after).toEqual(before); expect(JSON.stringify(after)).toContain("reviewed-meaning-v1");
      const newState = await preserved();
      await apply(packets, "restore");
      expect(await preserved()).toEqual(newState);
    } finally { await db.exec("rollback"); await owner(); }
  });
  it("fails closed when the compacted physical row or reference proof changes", async () => {
    await db.exec("begin");
    try {
      await db.query("update private.historical_learning_migrations set compacted_sha256=repeat('f',64) where kind='scope' and group_id=$1", [scopeId]);
      await expect(db.query("select private.assert_vocabulary_library_version_current_v1(v) from private.vocabulary_library_versions v where id=$1", [prepared.versionId])).rejects.toThrow("historical_learning_row_changed");
    } finally { await db.exec("rollback"); }
    await db.exec("begin");
    try {
      await db.query("update private.historical_learning_migrations set resource_refs=jsonb_set(resource_refs,'{selected,selectionHash}',to_jsonb(repeat('f',64))) where kind='composition' and group_id=$1", [prepared.versionId]);
      await expect(db.query("select private.vocabulary_composition_preparation_v1($1)", [prepared.versionId])).rejects.toThrow("historical_learning_reference_changed");
    } finally { await db.exec("rollback"); }
  });
  it("restores only the selected original bodies from the real file", async () => {
    expect((await apply(compositionPackets.slice(0, 2), "restore")).changed).toBe(2);
    expect(await reading()).toEqual(originalReading); expect(await meanings()).toEqual(originalMeanings);
    expect((await apply(compositionPackets.slice(2), "restore")).changed).toBe(4);
    expect((await apply(scopePackets, "restore")).changed).toBe(6);
    expect(await rows()).toEqual(originalRows); expect(await preserved()).toEqual(originalPreserved);
    expect(await scalar("select count(*)::int value from private.historical_learning_write_permits")).toBe(0);
  });
  it("resumes the protected pre-M01 build to all 501 entries without adopting a new storage format", async () => {
    await db.exec("begin");
    try {
      await admin();
      for (let n = 0; n < 2; n++) await scalar("select public.advance_vocabulary_template_book_v1($1::jsonb) value", [JSON.stringify(pendingCommand)]);
      await owner();
      expect(await scalar("select jsonb_build_object('next',next_row,'total',total_count,'complete',preparation_complete) value from private.vocabulary_composition_builds where version_id=$1", [pendingTemplate.versions[0]!.id])).toEqual({ next: 502, total: 501, complete: true });
      expect(await scalar("select count(*)::int value from private.vocabulary_composition_storage_formats where version_id=$1", [pendingTemplate.versions[0]!.id])).toBe(0);
    } finally { await db.exec("rollback"); await owner(); }
  });
  it("preserves bigint text outside JavaScript numbers and detects changed file bytes", () => {
    const beforeText = '{"id":9223372036854775806,"nested":{"id":9007199254740993}}';
    const file = saveHistoricalLearningArchive(archiveDirectory, { schemaVersion: "historical-learning-archive-v1", origin: "local-synthetic", packets: [{ id: randomUUID(), beforeText }] });
    expect(loadHistoricalLearningArchive(file.path, file.sha256).parameters.p_rows[0]!.beforeText).toBe(beforeText);
    fs.appendFileSync(file.path, " "); expect(() => loadHistoricalLearningArchive(file.path, file.sha256)).toThrow("사본의 내용이 달라졌습니다");
    expect(() => saveHistoricalLearningArchive(process.cwd(), { schemaVersion: "historical-learning-archive-v1", origin: "local-synthetic", packets: [{ id: randomUUID(), beforeText }] })).toThrow("저장소 밖");
    const otherCheckout = fs.mkdtempSync(path.join(os.tmpdir(), "fake-other-checkout-"));
    fs.writeFileSync(path.join(otherCheckout, ".git"), "gitdir: fake");
    expect(() => saveHistoricalLearningArchive(otherCheckout, { schemaVersion: "historical-learning-archive-v1", origin: "local-synthetic", packets: [{ id: randomUUID(), beforeText }] })).toThrow("모든 Git 저장소 밖");
  });
});
