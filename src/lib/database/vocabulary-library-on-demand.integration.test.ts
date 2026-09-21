import { createHash, randomUUID } from "node:crypto";
import { type PGlite } from "@electric-sql/pglite";
import { beforeAll, afterAll, describe, it, expect } from "vitest";
import { createFinalSchemaDatabase } from "@/test-support/final-schema-database";
import { EMPTY_LIBRARY_FILTERS, libraryCatalogSchema, libraryCommandResultSchema } from "@/features/wordbook-compositions/contracts/library";
import { libraryImportSchema, type LibraryImport } from "@/features/wordbook-compositions/contracts/library-import";
import { libraryQuerySchema, libraryQueryResultSchema, type LibraryCriteria, type LibraryQuery, type LibraryQueryResultOf, type LibraryTemplateSummary } from "@/features/wordbook-compositions/contracts/library-query";
import { libraryCommandV2ResultSchema } from "@/features/wordbook-compositions/contracts/library-command-v2";
import { compositionQuestionInputSchema, compositionStepSchema } from "@/features/wordbook-compositions/contracts/library-materialization";

const adminId = "00000000-0000-4000-8000-000000009601", project = "wojxpruvbjzbhrpmsbuy";
const sha = (s: string) => createHash("sha256").update(s).digest("hex");
const metadata = { title: "가짜 조건 템플릿", tags: [], school: null, targetGrade: "g12", schoolYear: 2026, semester: 2 as const, assessment: null, purpose: null };
describe.sequential("on-demand vocabulary summaries, criteria snapshots and deletion", () => {
  let db: PGlite, bundle: LibraryImport, template: LibraryTemplateSummary;
  const scalar = async <T>(sql: string, args: unknown[] = []) => (await db.query<{ value: T }>(sql, args)).rows[0]!.value;
  const owner = () => db.exec("reset role; select set_config('request.jwt.claim.sub','',false); select set_config('request.jwt.claim.role','',false)");
  const admin = () => db.exec(`reset role; set role authenticated; select set_config('request.jwt.claim.sub','${adminId}',false); select set_config('request.jwt.claim.role','authenticated',false)`);
  const service = () => db.exec("reset role; set role service_role; select set_config('request.jwt.claim.role','service_role',false)");
  const criteria: LibraryCriteria = { groups: [{ id: "mock", kind: "mock", datasetId: null, mode: "filter", filters: { ...EMPTY_LIBRARY_FILTERS, kinds: ["mock"], yearFrom: 2024, yearTo: 2025 }, scopes: [], excludedScopeKeys: [] }], excludedOccurrenceKeys: [], scopeStatus: "confirmed" };
  async function query<K extends LibraryQuery["kind"]>(kind: K, args: Record<string, unknown> = {}): Promise<LibraryQueryResultOf<K>> {
    const q = libraryQuerySchema.parse({ kind, ...args });
    const raw = await scalar<Record<string, unknown>>("select public.query_vocabulary_library_v1($1::jsonb) value", [JSON.stringify(q)]);
    if (kind === "preview") { delete raw.classifications; raw.automaticTags = []; raw.suggestedTitle = ""; }
    if (kind === "detail") { delete raw.classifications; raw.automaticTags = []; raw.sourceTags = []; }
    return libraryQueryResultSchema.parse(raw) as LibraryQueryResultOf<K>;
  }
  const preview = (c = criteria, compare: string | null = null) => query("preview", { selection: { mode: "criteria", criteria: c }, compareVersionId: compare, metadata });
  const save = async (request: unknown) => libraryCommandV2ResultSchema.parse(await scalar("select public.save_vocabulary_library_template_v2($1::jsonb) value", [JSON.stringify(request)]));
  async function register(input: LibraryImport) {
    await owner(); const text = JSON.stringify(input);
    await db.query("insert into private.vocabulary_library_import_approvals values($1,$2,private.reviewed_exam_sha256_v1($3::jsonb),$4,'fake-page') on conflict do nothing", [project, sha(text), text, input.scopes.length]);
    await service(); await db.query("select public.import_vocabulary_library_v1($1)", [text]); await admin();
  }
  beforeAll(async () => {
    db = await createFinalSchemaDatabase();
    await db.exec(`insert into auth.users(id) values('${adminId}'); insert into public.admin_profiles(user_id,display_name) values('${adminId}','가짜 관리자'); select set_config('request.jwt.claims','{"ref":"${project}"}',false)`);
    const source = await scalar<string>("insert into public.vocab_datasets(dataset_key,title,source_label,source_sha256,row_count,status,is_active) values('fake-library-pages','가짜 60행','fake',repeat('A',64),60,'ready',true) returning id value");
    const unit = await scalar<string>("insert into public.vocab_units(dataset_id,unit_label,normalized_label,unit_kind,unit_number,sort_index,entry_count) values($1,'가짜 지문','fake','day',1,1,60) returning id value", [source]);
    await db.query("insert into public.vocab_dataset_catalog(dataset_id,display_name,catalog_group,material_kind) values($1,'가짜 자료','high_mock','wordbook')", [source]);
    await db.query(`insert into public.vocab_entries(dataset_id,source_row,headword,headword_normalized,meanings,primary_meaning,row_sha256,unit_id,position_in_unit,entry_type)
      select $1,n,'sample'||n,'sample'||n,array['가짜 뜻 '||n],'가짜 뜻 '||n,upper(encode(extensions.digest('pages:'||n,'sha256'),'hex')),$2,n,'word' from generate_series(1,60)n`, [source, unit]);
    await db.query(`insert into public.vocab_entry_quiz_eligibility(vocab_entry_id,dataset_id,quiz_mode,status,input_content_hash,rule_version,evaluated_at_utc)
      select id,dataset_id,'book_meaning_en_to_ko','eligible',row_sha256,'fake',now() from public.vocab_entries where dataset_id=$1`, [source]);
    const rows = (await db.query<{ source_row: number; row_hash: string }>("select source_row,lower(row_sha256) row_hash from public.vocab_entries where dataset_id=$1 order by source_row", [source])).rows;
    const selected = { schemaVersion: "vocabulary-resource-snapshot-v1", sourceFields: {}, proofs: {}, pronunciation: { displayKo: null, variantId: null, audioUrl: null, available: false }, lexicalPos: null, dictionary: null, senseId: null, definitionEn: null, exampleEn: null, exampleKo: null };
    bundle = libraryImportSchema.parse({ schemaVersion: "vocabulary-library-import-v1", sourceCatalogHash: sha("catalog"), linksHash: sha("links"), referenceCatalogHash: sha("refs"), scopes: [2024, 2025, 2026].map((year, i) => ({
      key: `fake-${year}`, name: `${year}년 주제`, sourceTitle: "가짜 자료", source: { datasetId: source, unitId: unit, kind: "legacy_vocab", releaseId: null, releaseVersion: "a".repeat(64), fileHash: sha("file"), locator: `${year}` },
      classification: { kind: "mock", sourceGrade: "g12", exam: { executionYear: year, examMonth: 9, academicYear: null, examKind: "mock", agency: "가짜", typeCode: "topic", typeLabel: "주제", questionNumbers: [23], sharedPassage: false }, lesson: null, day: null, publisher: null, school: null, targetGrade: null, schoolYear: null, semester: null, assessment: null, purpose: null },
      rows: rows.slice(i * 20, (i + 1) * 20).map(r => ({ sourceRow: r.source_row, rowHash: r.row_hash, resources: { entryHash: r.row_hash, linkRecordHash: sha(`row:${r.source_row}`), selected } })),
    })) });
    await register(bundle);
  }, 60000);
  afterAll(async () => { await db?.close(); });

  it("pages scope headers and facets without occurrences and binds each cursor to the actor and filters", async () => {
    expect((await query("templates", { search: "" })).items).toEqual([]);
    const first = await query("scopes", { filters: EMPTY_LIBRARY_FILTERS, datasetId: null, limit: 2 });
    expect(first.items.map(s => s.classification.exam?.executionYear)).toEqual([2024, 2025]); expect(first.nextCursor).not.toBeNull();
    expect(JSON.stringify(first)).not.toMatch(/occurrences|rowHash|correctChoice|entry_snapshot|includedKeys/);
    const next = await query("scopes", { filters: EMPTY_LIBRARY_FILTERS, datasetId: null, limit: 2, cursor: first.nextCursor });
    expect(next.items.map(s => s.classification.exam?.executionYear)).toEqual([2026]); expect(next.nextCursor).toBeNull();
    await expect(query("scopes", { filters: { ...EMPTY_LIBRARY_FILTERS, years: [2025] }, datasetId: null, limit: 2, cursor: first.nextCursor })).rejects.toThrow("library_cursor_changed");
    const facets = await query("facets", { sourceKind: "mock", datasetId: null });
    expect(facets.facets.years.map(o => o.value)).toEqual([2024, 2025, 2026]); expect(facets.facets.types).toEqual([{ value: "topic", label: "주제", count: 3 }]);
    expect(JSON.stringify(facets)).not.toMatch(/scopeKey|occurrences|rowHash/);
  });
  it("saves criteria with the exact preview and pages selected words and historical versions", async () => {
    const p = await preview(); expect(p.includedCount).toBe(40); expect(p.recipe.scopes).toHaveLength(2);
    const request = { action: "create", requestId: randomUUID(), metadata, criteria, recipe: p.recipe, previewHash: p.contentHash };
    const result = await save(request); if (!("template" in result)) throw Error("unexpected delete"); template = result.template;
    expect(await save(request)).toEqual(result); expect(JSON.stringify(result)).not.toMatch(/includedKeys|occurrences|"versions"|"recipe"/);
    const detail = await query("detail", { templateId: template.id }); expect(detail.criteria).toEqual(criteria); expect(detail.recipe).toEqual(p.recipe);
    const first = await query("words", { selection: { mode: "criteria", criteria }, contentHash: p.contentHash, search: "", limit: 10 });
    const next = await query("words", { selection: { mode: "criteria", criteria }, contentHash: p.contentHash, search: "", limit: 10, cursor: first.nextCursor });
    expect(first.total).toBe(40); expect(first.items.map(x => x.sourceRow)).toEqual(Array.from({ length: 10 }, (_, i) => i + 1));
    expect(next.items.map(x => x.sourceRow)).toEqual(Array.from({ length: 10 }, (_, i) => i + 11));
    expect(JSON.stringify(first)).not.toMatch(/resources|correctChoice|entryHash|documentHash/);
    const excluded = { ...criteria, excludedOccurrenceKeys: [first.items[0]!.key] }, ep = await preview(excluded);
    expect(ep.includedCount).toBe(39);
    await expect(query("words", { selection: { mode: "criteria", criteria: excluded }, contentHash: p.contentHash, search: "", limit: 10 })).rejects.toThrow("library_content_changed");
    const orphan = await preview({ ...criteria, excludedOccurrenceKeys: ["f".repeat(64)] }); expect(orphan.orphanedExclusions).toEqual(["f".repeat(64)]);
    await expect(save({ ...request, requestId: randomUUID(), criteria: { ...criteria, excludedOccurrenceKeys: ["f".repeat(64)] } })).rejects.toThrow("library_criteria_changed");
  });
  it("recalculates filters after registration but preserves old exact scopes and reports additions without false reordering", async () => {
    const before = await preview(), oldVersion = template.latestVersion;
    const extra = structuredClone(bundle); extra.scopes = [extra.scopes[2]!]; extra.scopes[0]!.key = "fake-added-2025"; extra.scopes[0]!.name = "2025년 추가 주제";
    extra.scopes[0]!.classification.exam!.executionYear = 2025;
    await register(extra);
    const p = await preview(criteria, oldVersion.id); expect(p.includedCount).toBe(60); expect(p.difference).toMatchObject({ added: 20, removed: 0, scopeAdded: 1, orderChanged: false, changed: true });
    await expect(save({ action: "version", requestId: randomUUID(), templateId: template.id, expectedRevision: template.revision, expectedContentHash: oldVersion.contentHash, metadata, criteria, recipe: before.recipe, previewHash: before.contentHash })).rejects.toThrow("library_criteria_changed");
    const result = await save({ action: "version", requestId: randomUUID(), templateId: template.id, expectedRevision: template.revision, expectedContentHash: oldVersion.contentHash, metadata, criteria, recipe: p.recipe, previewHash: p.contentHash });
    if (!("template" in result)) throw Error("unexpected delete"); template = result.template;
    const first = await query("versions", { templateId: template.id, limit: 1 }); expect(first.items[0]!.number).toBe(2);
    const second = await query("versions", { templateId: template.id, limit: 1, cursor: first.nextCursor }); expect(second.items[0]).toEqual(oldVersion);
    const old = await query("detail", { templateId: template.id, versionId: oldVersion.id }); expect(old.recipe).toEqual(before.recipe);
    const words = await query("words", { versionId: oldVersion.id, contentHash: oldVersion.contentHash, search: "", limit: 50 }); expect(words.total).toBe(40);
    const refs = await query("scopes", { refs: [...old.recipe.scopes].reverse(), filters: EMPTY_LIBRARY_FILTERS, datasetId: null }); expect(refs.items.map(s => s.id)).toEqual([...old.recipe.scopes].reverse().map(s => s.id));
  });
  it("finds years and semesters even without tags and compacts historical receipts without reading current metadata", async () => {
    expect((await query("templates", { search: "2026 2학기" })).items.map(t => t.id)).toContain(template.id);
    expect((await query("templates", { search: "2024 주제 고3 모고" })).items.map(t => t.id)).toContain(template.id);
    expect((await query("templates", { search: "2024 수능" })).items).toEqual([]);
    const oldRequest = { action: "metadata", requestId: randomUUID(), templateId: template.id, expectedRevision: template.revision, metadata: { ...metadata, title: "저장 당시 이름" } };
    const original = libraryCommandResultSchema.parse(await scalar("select public.save_vocabulary_library_template_v1($1::jsonb) value", [JSON.stringify(oldRequest)]));
    const newer = await save({ ...oldRequest, requestId: randomUUID(), expectedRevision: original.template.revision, metadata: { ...metadata, title: "현재 이름" } });
    if (!("template" in newer)) throw Error("unexpected delete"); template = newer.template;
    const retry = await save(oldRequest); expect(retry).toMatchObject({ template: { metadata: { title: "저장 당시 이름" }, revision: original.template.revision } });
    const copies = [];
    for (let i = 0; i < 2; i++) copies.push(await save({ action: "copy", requestId: randomUUID(), sourceVersionId: template.latestVersion.id, metadata: { ...metadata, title: `가짜 복사 ${i}` } }));
    const first = await query("templates", { search: "", limit: 2 }), next = await query("templates", { search: "", limit: 2, cursor: first.nextCursor });
    expect(new Set([...first.items, ...next.items].map(t => t.id)).size).toBe(3); expect(copies).toHaveLength(2);
  });
  it("hides a deleted template, preserves sources and started books, resumes only the original request and can finish it", async () => {
    const request = { action: "materialize", requestId: randomUUID(), templateId: template.id, versionId: template.latestVersion.id, contentHash: template.latestVersion.contentHash };
    const advance = async (r = request) => compositionStepSchema.parse(await scalar("select public.advance_vocabulary_template_book_v1($1::jsonb) value", [JSON.stringify(r)]));
    const started = await advance(); expect(started.state).toBe("preparing");
    await owner(); const before = await scalar<string>("select md5(jsonb_agg(to_jsonb(e) order by e.id)::text) value from public.vocab_entries e where dataset_id=$1", [bundle.scopes[0]!.source.datasetId]);
    await admin();
    const deletion = { action: "delete", requestId: randomUUID(), templateId: template.id, expectedRevision: template.revision };
    const result = await save(deletion); expect(await save(deletion)).toEqual(result);
    expect((await query("templates", { search: "" })).items.some(t => t.id === template.id)).toBe(false);
    await expect(query("detail", { templateId: template.id })).rejects.toThrow("library_template_not_found");
    await expect(save({ action: "metadata", requestId: randomUUID(), templateId: template.id, expectedRevision: template.revision + 1, metadata })).rejects.toThrow("library_template_not_found");
    await expect(save({ action: "copy", requestId: randomUUID(), sourceVersionId: template.latestVersion.id, metadata })).rejects.toThrow("library_template_not_found");
    for (const fn of ["advance_vocabulary_template_book_v1", "prepare_vocabulary_template_book_v1", "prepare_vocabulary_template_question_input_v1"])
      await expect(scalar(`select public.${fn}($1::jsonb) value`, [JSON.stringify({ ...request, requestId: randomUUID() })])).rejects.toThrow("library_template_not_found");
    let step = await advance(); for (let i = 0; i < 5 && step.stage !== "prepared"; i++) step = await advance(); expect(step.stage).toBe("prepared");
    const prep = compositionQuestionInputSchema.parse(await scalar("select public.prepare_vocabulary_template_question_input_v1($1::jsonb) value", [JSON.stringify(request)]));
    const questions = prep.entries.map((e, i) => { const choices = Array.from({ length: 4 }, (_, j) => prep.entries[(i + j) % prep.entries.length]!);
      return { vocabEntryId: e.id, direction: "english_to_korean", prompt: e.headword, choices: choices.map(c => c.primaryMeaning), choiceVocabEntryIds: choices.map(c => c.id), correctChoiceIndex: 0 }; });
    await service(); step = compositionStepSchema.parse(await scalar("select public.advance_vocabulary_composition_questions_v1($1,$2,$3::jsonb) value", [request.versionId, request.contentHash, JSON.stringify(questions)]));
    for (let i = 0; i < 5 && step.state !== "ready"; i++) step = compositionStepSchema.parse(await scalar("select public.advance_vocabulary_composition_questions_v1($1,$2,null) value", [request.versionId, request.contentHash]));
    expect(step.state).toBe("ready"); await admin(); expect((await advance()).state).toBe("ready");
    const summary = libraryCommandV2ResultSchema.parse(await scalar("select public.get_vocabulary_composition_summary_v2($1) value", [request.versionId])); expect(summary).toMatchObject({ createdBook: { dataset: { id: started.datasetId, rowCount: 60, status: "ready" } } });
    await owner(); expect(await scalar("select md5(jsonb_agg(to_jsonb(e) order by e.id)::text) value from public.vocab_entries e where dataset_id=$1", [bundle.scopes[0]!.source.datasetId])).toBe(before);
    expect(await scalar("select count(*)::integer value from private.vocabulary_library_versions where template_id=$1", [template.id])).toBe(2);
    await admin(); expect(libraryCatalogSchema.parse(await scalar("select public.list_vocabulary_library_v1() value")).templates.some(t => t.id === template.id)).toBe(false);
  });
  it("rejects anonymous, student and service-role queries and direct access to preserved internal generators", async () => {
    for (const role of ["anon", "authenticated", "service_role"]) {
      await owner(); await db.exec(`set role ${role}; select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000009699',false)`);
      await expect(scalar("select public.query_vocabulary_library_v1('{\"kind\":\"templates\",\"search\":\"\"}') value")).rejects.toThrow();
      await expect(scalar("select private.advance_vocabulary_template_book_before_delete_v1('{}') value")).rejects.toThrow();
    }
  });
});
