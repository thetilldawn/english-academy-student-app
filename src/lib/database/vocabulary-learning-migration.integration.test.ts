import { createHash, randomUUID } from "node:crypto";
import type { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createFinalSchemaDatabase } from "@/test-support/final-schema-database";
import { EMPTY_LIBRARY_FILTERS, libraryCatalogSchema, libraryCommandResultSchema } from "@/features/wordbook-compositions/contracts/library";
import { compositionQuestionInputSchema, compositionStepSchema } from "@/features/wordbook-compositions/contracts/library-materialization";

const adminId = "00000000-0000-4000-8000-000000008601", project = "wojxpruvbjzbhrpmsbuy";
const sha = (s: string) => createHash("sha256").update(s).digest("hex");
const resource = { schemaVersion: "vocabulary-resource-snapshot-v1", sourceFields: { headword: "Fake source proof" }, proofs: {},
  pronunciation: { displayKo: "가짜", variantId: "fake:v1", audioUrl: null, available: false }, lexicalPos: "noun", dictionary: null, senseId: null,
  definitionEn: "An old definition.", exampleEn: "An old example.", exampleKo: "기존 예문." };
type Command = { action: "materialize"; requestId: string; templateId: string; versionId: string; contentHash: string };
type Question = { vocabEntryId: number; direction: string; prompt: string; choices: string[]; choiceVocabEntryIds: number[]; correctChoiceIndex: number };
describe.sequential("vocabulary v1 to v2 migration with actual interrupted legacy builds", () => {
  let db: PGlite, sourceId: string, originalText: string, entriesCommand: Command, questionsCommand: Command, completedCommand: Command;
  let seedBundle: Record<string, unknown>, seedScope: { key: string; name: string; sourceTitle: string; source: Record<string, unknown>; classification: Record<string, unknown>; rows: { sourceRow: number; rowHash: string; resources: { entryHash: string; linkRecordHash: string; selected: typeof resource } }[] };
  let hookCount = 0, beforeEntries: unknown, beforeQuestions: unknown, beforeCompleted: unknown, beforeScopes: unknown;
  const scalar = async <T>(sql: string, args: unknown[] = []) => (await db.query<{ value: T }>(sql, args)).rows[0]!.value;
  const owner = () => db.exec("reset role; select set_config('request.jwt.claim.role','',false)");
  const admin = () => db.exec(`reset role; set role authenticated; select set_config('request.jwt.claim.sub','${adminId}',false); select set_config('request.jwt.claim.role','authenticated',false)`);
  const service = () => db.exec("reset role; set role service_role; select set_config('request.jwt.claim.role','service_role',false)");
  const advance = async (command: Command) => compositionStepSchema.parse(await scalar("select public.advance_vocabulary_template_book_v1($1::jsonb) value", [JSON.stringify(command)]));
  const finish = async (command: Command, questions: Question[] | null = null) => compositionStepSchema.parse(await scalar("select public.advance_vocabulary_composition_questions_v1($1,$2,$3::jsonb) value", [command.versionId, command.contentHash, questions === null ? null : JSON.stringify(questions)]));
  const plan = async (command: Command) => {
    await admin();
    const p = compositionQuestionInputSchema.parse(await scalar("select public.prepare_vocabulary_template_question_input_v1($1::jsonb) value", [JSON.stringify(command)]));
    return p.entries.map((e, i) => { const choices = Array.from({ length: 4 }, (_, j) => p.entries[(i + j) % p.entries.length]!);
      return { vocabEntryId: e.id, direction: "english_to_korean", prompt: e.headword, choices: choices.map(c => c.primaryMeaning), choiceVocabEntryIds: choices.map(c => c.id), correctChoiceIndex: 0 }; });
  };
  const create = async (title: string, scopeRefs: { id: string; version: string }[], excludedOccurrenceKeys: string[] = []) => {
    await admin();
    const template = libraryCommandResultSchema.parse(await scalar("select public.save_vocabulary_library_template_v1($1::jsonb) value", [JSON.stringify({ action: "create", requestId: randomUUID(),
      metadata: { title, tags: [], school: null, targetGrade: null, schoolYear: null, semester: null, assessment: null, purpose: null },
      recipe: { filters: EMPTY_LIBRARY_FILTERS, scopes: scopeRefs, excludedOccurrenceKeys, scopeStatus: "confirmed" } })])).template;
    return { action: "materialize" as const, requestId: randomUUID(), templateId: template.id, versionId: template.versions[0]!.id, contentHash: template.versions[0]!.contentHash };
  };
  const snapshot = (command: Command) => scalar(`select jsonb_build_object(
    'entries',(select jsonb_agg(to_jsonb(e) order by e.vocab_entry_id) from private.vocabulary_composition_entries e where e.version_id=$1),
    'items',(select jsonb_agg(to_jsonb(i) order by i.item_id) from private.vocabulary_composition_items i where i.version_id=$1)) value`, [command.versionId]);
  const scopeSnapshot = () => scalar("select jsonb_build_object('scopes',(select jsonb_agg(to_jsonb(s) order by id) from private.vocabulary_library_scopes s),'rows',(select jsonb_agg(to_jsonb(r) order by scope_id,source_row) from private.vocabulary_library_scope_rows r),'fingerprints',(select jsonb_agg(to_jsonb(f) order by scope_id,occurrence_key) from private.vocabulary_library_row_fingerprints f)) value");
  const importBundle = async (bundle: Record<string, unknown>, approval: string) => {
    const text = JSON.stringify(bundle);
    await owner();
    await db.query("insert into private.vocabulary_library_import_approvals values($1,$2,private.reviewed_exam_sha256_v1($3::jsonb),1,$4)", [project, sha(text), text, approval]);
    await service(); await db.query("select public.import_vocabulary_library_v1($1)", [text]);
    return text;
  };

  beforeAll(async () => {
    db = await createFinalSchemaDatabase({ beforeMigration: async (database, migration) => {
      if (migration !== "20261001132340_compact_vocabulary_learning_values.sql") return;
      hookCount++; db = database;
      expect(await scalar("select to_regclass('private.vocabulary_learning_value_versions')::text value")).toBeNull();
      await db.exec(`insert into auth.users values('${adminId}'); insert into public.admin_profiles(user_id,display_name) values('${adminId}','가짜 이전 관리자'); select set_config('request.jwt.claims','{"ref":"${project}"}',false)`);
      sourceId = await scalar("insert into public.vocab_datasets(dataset_key,title,source_label,source_sha256,row_count,status,is_active) values('fake-m01-old','가짜 이전 501행','fake',repeat('A',64),501,'ready',true) returning id value");
      const unit = await scalar<string>("insert into public.vocab_units(dataset_id,unit_label,normalized_label,unit_kind,unit_number,sort_index,entry_count) values($1,'DAY 1','day1','day',1,1,501) returning id value", [sourceId]);
      await db.query("insert into public.vocab_dataset_catalog(dataset_id,display_name,catalog_group,material_kind) values($1,'가짜 이전','high','wordbook')", [sourceId]);
      await db.query("insert into public.vocab_entries(dataset_id,source_row,headword,headword_normalized,meanings,primary_meaning,row_sha256,unit_id,position_in_unit,entry_type,english_definition,example_en,example_ko,pronunciation_ko) select $1,n,'oldword'||n,'oldword'||n,array['옛 뜻 '||n],'옛 뜻 '||n,upper(encode(extensions.digest('old:'||n,'sha256'),'hex')),$2,n,'word','Entry definition.','Entry example.','원래 예문.','원표기' from generate_series(1,501)n", [sourceId, unit]);
      await db.query("insert into public.vocab_entry_quiz_eligibility(vocab_entry_id,dataset_id,quiz_mode,status,input_content_hash,rule_version,evaluated_at_utc) select id,dataset_id,'book_meaning_en_to_ko','eligible',row_sha256,'fake-old',now() from public.vocab_entries where dataset_id=$1", [sourceId]);
      const rows = (await db.query<{ source_row: number; hash: string }>("select source_row,lower(row_sha256) hash from public.vocab_entries where dataset_id=$1 order by source_row", [sourceId])).rows;
      seedScope = { key: "fake-old-scope", name: "가짜 이전 범위", sourceTitle: "가짜 원자료", source: { datasetId: sourceId, unitId: unit, kind: "legacy_vocab", releaseId: null, releaseVersion: "a".repeat(64), fileHash: sha("fake-file"), locator: "fake-source.json" },
        classification: { kind: "wordbook", sourceGrade: "g11", exam: null, lesson: null, day: 1, publisher: null, school: null, targetGrade: null, schoolYear: null, semester: null, assessment: null, purpose: null },
        rows: rows.map(r => ({ sourceRow: r.source_row, rowHash: r.hash, resources: { entryHash: r.hash, linkRecordHash: sha(`old-link:${r.source_row}`), selected: resource } })) };
      seedBundle = { schemaVersion: "vocabulary-library-import-v1", sourceCatalogHash: sha("catalog"), linksHash: sha("links"), referenceCatalogHash: sha("refs"), scopes: [seedScope] };
      originalText = await importBundle(seedBundle, "fake-old-approval");
      await admin();
      const scopes = libraryCatalogSchema.parse(await scalar("select public.list_vocabulary_library_v1() value")).scopes;
      const refs = scopes.map(s => ({ id: s.id, version: s.version }));
      entriesCommand = await create("가짜 단어 500행 중단", refs);
      expect(await advance(entriesCommand)).toMatchObject({ stage: "entries", done: 500 });
      questionsCommand = await create("가짜 문항 500개 중단", refs);
      await advance(questionsCommand); await advance(questionsCommand); await advance(questionsCommand);
      const questions = await plan(questionsCommand); await service();
      expect(await finish(questionsCommand, questions)).toMatchObject({ stage: "questions", done: 500 });
      completedCommand = await create("가짜 이전 완료", refs, scopes[0]!.occurrences.slice(6).map(o => o.key));
      await advance(completedCommand); await advance(completedCommand);
      const small = await plan(completedCommand); await service();
      await finish(completedCommand, small);
      expect(await finish(completedCommand)).toMatchObject({ state: "ready" });
      await owner();
      beforeEntries = await snapshot(entriesCommand); beforeQuestions = await snapshot(questionsCommand); beforeCompleted = await snapshot(completedCommand); beforeScopes = await scopeSnapshot();
    } });
  }, 120_000);
  afterAll(async () => { await db?.close(); });

  it("migrates without rewriting any preexisting source, fingerprint, entry, or question", async () => {
    expect(hookCount).toBe(1);
    expect(await snapshot(entriesCommand)).toEqual(beforeEntries);
    expect(await snapshot(questionsCommand)).toEqual(beforeQuestions);
    expect(await snapshot(completedCommand)).toEqual(beforeCompleted);
    expect(await scopeSnapshot()).toEqual(beforeScopes);
    expect(await scalar("select count(*)::int value from private.vocabulary_composition_storage_formats")).toBe(0);
    expect(await scalar("select count(*)::int value from private.vocabulary_learning_value_versions")).toBe(0);
    await service(); await db.query("select public.import_vocabulary_library_v1($1)", [originalText]); await owner();
    expect(await scopeSnapshot()).toEqual(beforeScopes);
    expect(await scalar("select count(*)::int value from private.vocabulary_learning_value_versions")).toBe(0);
  });
  it("resumes both actual old cursors with v1 fields and the first committed 500 records unchanged", async () => {
    await admin(); expect(await advance(entriesCommand)).toMatchObject({ stage: "entries", done: 501 });
    await advance(entriesCommand);
    const questions = await plan(entriesCommand); await service();
    await finish(entriesCommand, questions); await finish(entriesCommand);
    expect(await finish(entriesCommand)).toMatchObject({ state: "ready" });
    expect(await finish(questionsCommand)).toMatchObject({ stage: "questions", done: 501 });
    expect(await finish(questionsCommand)).toMatchObject({ state: "ready" });
    await owner();
    const after = await snapshot(entriesCommand) as { entries: unknown[]; items: unknown[] };
    expect(after.entries.slice(0, 500)).toEqual((beforeEntries as { entries: unknown[] }).entries);
    const afterQ = await snapshot(questionsCommand) as { entries: unknown[]; items: { item_id: string }[] };
    const beforeQ = beforeQuestions as { entries: unknown[]; items: { item_id: string }[] };
    expect(afterQ.entries).toEqual(beforeQ.entries);
    const oldItemIds = new Set(beforeQ.items.map(i => i.item_id));
    expect(afterQ.items.filter(i => oldItemIds.has(i.item_id))).toEqual(beforeQ.items);
    expect(await scalar("select bool_and(resources#>>'{selected,schemaVersion}'='vocabulary-resource-snapshot-v1') value from private.vocabulary_composition_entries")).toBe(true);
    expect(await snapshot(completedCommand)).toEqual(beforeCompleted);
    expect(await scalar("select count(*)::int value from private.vocabulary_learning_value_versions")).toBe(0);
  });
  it("combines overlapping v1 and v2 sources while retaining every link hash and old source snapshot", async () => {
    const scope = structuredClone(seedScope); scope.key = "fake-new-overlap"; scope.name = "새 겹친 범위";
    scope.rows = scope.rows.filter(r => [2, 3, 4].includes(r.sourceRow)).map(r => ({ ...r, resources: { ...r.resources, linkRecordHash: sha(`new-link:${r.sourceRow}`) } }));
    await importBundle({ ...seedBundle, scopes: [scope] }, "fake-new-approval");
    await admin(); const scopes = libraryCatalogSchema.parse(await scalar("select public.list_vocabulary_library_v1() value")).scopes;
    const command = await create("옛 방식과 새 방식", scopes.map(s => ({ id: s.id, version: s.version })));
    await owner();
    const fixed = await scalar<{ sourceCount: number; occurrences: { sourceRow: number; linkRecordHashes: string[] }[] }>("select fixed_composition value from private.vocabulary_library_versions where id=$1", [command.versionId]);
    expect(fixed.sourceCount).toBe(501);
    expect(fixed.occurrences.find(r => r.sourceRow === 2)!.linkRecordHashes.sort()).toEqual([sha("old-link:2"), sha("new-link:2")].sort());
    expect(await scalar("select count(*)::int value from private.vocabulary_learning_value_versions")).toBe(3);
    await admin(); await advance(command); await advance(command); await advance(command);
    await owner();
    expect(await scalar("select bool_and(resources#>>'{selected,schemaVersion}'='vocabulary-resource-ref-v2') value from private.vocabulary_composition_entries where version_id=$1", [command.versionId])).toBe(true);
    expect(await scalar("select count(*)::int value from private.vocabulary_learning_value_versions")).toBe(501);
    expect(await snapshot(completedCommand)).toEqual(beforeCompleted);
  });
  it("rejects proof-only differences and detects changed full source content without changing its row SHA", async () => {
    const bad = structuredClone(seedScope); bad.key = "fake-conflicting-proof"; bad.rows = bad.rows.slice(1, 2);
    bad.rows[0]!.resources.selected.sourceFields.headword = "Different source evidence with the same display";
    await importBundle({ ...seedBundle, scopes: [bad] }, "fake-conflict-approval");
    await admin(); const scopes = libraryCatalogSchema.parse(await scalar("select public.list_vocabulary_library_v1() value")).scopes;
    await expect(create("거절할 겹친 근거", scopes.filter(s => s.name !== "새 겹친 범위").map(s => ({ id: s.id, version: s.version })))).rejects.toThrow("library_overlapping_rows_conflict");
    await owner(); await db.exec("begin");
    try {
      await db.query("update public.vocab_entries set example_en='Changed without updating row_sha256' where dataset_id=$1 and source_row=2", [sourceId]);
      const states = await scalar<string[]>("select jsonb_agg(private.vocabulary_library_source_state_v1(s)) value from private.vocabulary_library_scopes s");
      expect(states.every(s => s === "changed")).toBe(true);
      const batch = await scalar<Record<string, string>>("select private.vocabulary_library_source_states_v1((select array_agg(id) from private.vocabulary_library_scopes)) value");
      expect(Object.keys(batch)).toHaveLength(3);
      expect(Object.values(batch).every(s => s === "changed")).toBe(true);
      expect(await snapshot(completedCommand)).toEqual(beforeCompleted);
    } finally { await db.exec("rollback"); }
  });
  it("preserves the former SQL v1 comparison contract without imposing new registration fields", async () => {
    const minimal = { schemaVersion: "vocabulary-resource-snapshot-v1", proofs: {}, pronunciation: { displayKo: null, variantId: null, audioUrl: null, available: false } };
    expect(await scalar("select private.vocabulary_composition_resource_v1($1::jsonb) value", [JSON.stringify({ selected: minimal })])).toEqual(minimal);
    const comparison = await scalar("select private.vocabulary_selection_comparison_v2(null,$1::jsonb) value", [JSON.stringify({ selected: minimal })]);
    expect(comparison).toEqual({ originalSelectedHash: await scalar("select private.reviewed_exam_sha256_v1($1::jsonb) value", [JSON.stringify(minimal)]) });
  });
});
