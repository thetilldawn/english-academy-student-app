import { createHash, randomUUID } from "node:crypto";
import type { PGlite } from "@electric-sql/pglite";
import { beforeAll, afterAll, describe, it, expect, vi } from "vitest";
import { createFinalSchemaDatabase } from "@/test-support/final-schema-database";
import { EMPTY_LIBRARY_FILTERS, libraryCatalogSchema, libraryCommandResultSchema, type LibraryTemplate } from "@/features/wordbook-compositions/contracts/library";
import { compositionPreparationSchema, compositionQuestionInputSchema, compositionCompletionSummarySchema, type CompositionPreparation } from "@/features/wordbook-compositions/contracts/library-materialization";
import { planCompositionQuestions } from "@/features/wordbook-compositions/server/use-cases/composition-question-plan";
import { planLibraryUnits } from "@/features/wordbook-compositions/domain/library-selection";
import { reviewedExamFixture } from "@/test-support/reviewed-exam-fixtures";
import { vocabPronunciationReleaseHeader } from "@/lib/vocab/vocab-pronunciation-release-v2-contract";
vi.mock("server-only", () => ({}));

const adminId = "00000000-0000-4000-8000-000000008001";
const studentId = "00000000-0000-4000-8000-000000008002";
const hash = (value: string) => createHash("sha256").update(value).digest("hex");
const emptyPronunciation = { displayKo: null, variantId: null, audioUrl: null, available: false };
const resource = { schemaVersion: "vocabulary-resource-snapshot-v1", sourceFields: {}, proofs: {}, pronunciation: emptyPronunciation,
  lexicalPos: null, dictionary: null, senseId: null, definitionEn: null, exampleEn: null, exampleKo: null };
describe.sequential("vocabulary compositions: source resources, questions, and real delivery", () => {
  let db: PGlite, originalDataset: string, template: LibraryTemplate, prepared: CompositionPreparation, schoolPrepared: CompositionPreparation, schoolAssignment: string;
  const scalar = async <T>(sql: string, args: unknown[] = []) => (await db.query<{ value: T }>(sql, args)).rows[0]!.value;
  const admin = () => db.exec(`reset role; set role authenticated; select set_config('request.jwt.claim.sub','${adminId}',false); select set_config('request.jwt.claim.role','authenticated',false);`);
  const service = () => db.exec("reset role; set role service_role; select set_config('request.jwt.claim.role','service_role',false);");
  beforeAll(async () => {
    db = await createFinalSchemaDatabase();
    await db.exec(`insert into auth.users(id) values('${adminId}'); insert into public.admin_profiles(user_id,display_name) values('${adminId}','가짜 관리자');
      insert into public.students(id,display_name,created_by) values('${studentId}','가짜 학생','${adminId}');
      select set_config('request.jwt.claims','{"ref":"wojxpruvbjzbhrpmsbuy"}',false);`);
    originalDataset = await scalar<string>(`insert into public.vocab_datasets(dataset_key,title,source_label,source_sha256,row_count,status,is_active)
      values('fake-compose-day','가짜 일반 자료','fake',repeat('A',64),6,'ready',true) returning id value`);
    const unit = await scalar<string>(`insert into public.vocab_units(dataset_id,unit_label,normalized_label,unit_kind,unit_number,sort_index,entry_count)
      values($1,'DAY 1','day1','day',1,1,6) returning id value`, [originalDataset]);
    await db.query("insert into public.vocab_dataset_catalog(dataset_id,display_name,catalog_group,material_kind) values($1,'가짜 자료','high','wordbook')", [originalDataset]);
    await db.query(`insert into public.vocab_entries(dataset_id,source_row,headword,headword_normalized,meanings,primary_meaning,row_sha256,unit_id,position_in_unit,entry_type)
      select $1,n,'testword'||n,'testword'||n,array['시험 뜻 '||n],'시험 뜻 '||n,upper(encode(extensions.digest('compose:'||n,'sha256'),'hex')),$2,n,'word' from generate_series(1,6)n`, [originalDataset, unit]);
    await db.query(`insert into public.vocab_entry_quiz_eligibility(vocab_entry_id,dataset_id,quiz_mode,status,input_content_hash,rule_version,evaluated_at_utc)
      select e.id,e.dataset_id,m,'eligible',e.row_sha256,'fake-original-review',now() from public.vocab_entries e cross join unnest(array['book_meaning_en_to_ko','book_meaning_ko_to_en'])m where e.dataset_id=$1`, [originalDataset]);
    const rows = (await db.query<{ source_row: number; row_hash: string }>("select source_row,lower(row_sha256) row_hash from public.vocab_entries where dataset_id=$1 order by source_row", [originalDataset])).rows;
    const classification = { kind: "wordbook", sourceGrade: "g11", exam: null, lesson: null, day: 1, publisher: null,
      school: null, targetGrade: null, schoolYear: null, semester: null, assessment: null, purpose: null };
    const bundle = { schemaVersion: "vocabulary-library-import-v1", sourceCatalogHash: "b".repeat(64), linksHash: "c".repeat(64), referenceCatalogHash: "d".repeat(64),
      scopes: [[1, 2, 3], [5, 6], [2, 3, 4]].map((selection, index) => ({ key: `fake-block-${index}`, name: `가짜 범위 ${index}`, sourceTitle: "가짜 일반 자료",
        source: { datasetId: originalDataset, unitId: unit, kind: "legacy_vocab", releaseId: null, releaseVersion: "a".repeat(64), fileHash: "e".repeat(64), locator: "fake.json" }, classification,
        rows: rows.filter(r => selection.includes(r.source_row)).map(r => ({ sourceRow: r.source_row, rowHash: r.row_hash,
          resources: { entryHash: r.row_hash, linkRecordHash: hash(`scope:${index}:row:${r.source_row}`), selected: resource } })) })) };
    const input = JSON.stringify(bundle);
    const contentHash = await scalar<string>("select private.reviewed_exam_sha256_v1($1::jsonb) value", [input]);
    await db.query("insert into private.vocabulary_library_import_approvals values('wojxpruvbjzbhrpmsbuy',$1,$2,3,'fake-compose-approval')", [hash(input), contentHash]);
    await service(); await db.query("select public.import_vocabulary_library_v1($1)", [input]);
    await admin();
    const catalog = libraryCatalogSchema.parse(await scalar("select public.list_vocabulary_library_v1() value"));
    const recipe = { filters: EMPTY_LIBRARY_FILTERS, scopes: catalog.scopes.map(s => ({ id: s.id, version: s.version })), excludedOccurrenceKeys: [], scopeStatus: "confirmed" };
    const result = libraryCommandResultSchema.parse(await scalar("select public.save_vocabulary_library_template_v1($1::jsonb) value", [JSON.stringify({ action: "create", requestId: randomUUID(),
      metadata: { title: "가짜 부분 범위 조합", tags: [], school: null, targetGrade: "g11", schoolYear: 2026, semester: null, assessment: null, purpose: null }, recipe })]));
    template = result.template;
  }, 60_000);
  afterAll(async () => { await db?.close(); });
  it("materializes consecutive disjoint units while keeping overlap membership and source order", async () => {
    const v = template.versions[0]!;
    const command = { action: "materialize", requestId: randomUUID(), templateId: template.id, versionId: v.id, contentHash: v.contentHash };
    const slim = compositionQuestionInputSchema.parse(await scalar("select public.prepare_vocabulary_template_question_input_v1($1::jsonb) value", [JSON.stringify(command)]));
    prepared = compositionPreparationSchema.parse(await scalar("select public.prepare_vocabulary_composition_v1($1,$2) value", [v.id, v.contentHash]));
    expect(slim).toEqual({ ...prepared, entries: prepared.entries.map(e => Object.fromEntries(Object.entries(e).filter(([key]) => key !== "resources"))) });
    expect(JSON.stringify(slim)).not.toMatch(/resources|correct_choice|choice_texts/);
    expect(planCompositionQuestions(slim)).toHaveLength(12);
    expect(await scalar("select public.prepare_vocabulary_template_question_input_v1($1::jsonb) value", [JSON.stringify(command)])).toEqual(slim);
    expect(await scalar("select public.prepare_vocabulary_template_book_v1($1::jsonb) value", [JSON.stringify(command)])).toEqual(prepared);
    await expect(db.query("select public.prepare_vocabulary_template_question_input_v1($1::jsonb)", [JSON.stringify({ ...command, contentHash: "f".repeat(64) })])).rejects.toThrow("library_request_reused");
    expect(prepared.entries).toHaveLength(6); expect(prepared.state).toBe("preparing");
    expect(prepared.entries.map(e => e.headword)).toEqual(["testword1", "testword2", "testword3", "testword5", "testword6", "testword4"]);
    const catalog = libraryCatalogSchema.parse(await scalar("select public.list_vocabulary_library_v1() value"));
    const units = planLibraryUnits(catalog.scopes, v.recipe);
    const dbUnits = await scalar<{ entry_count: number; metadata: { librarySourceScopes: { id: string }[] } }[]>(`select jsonb_agg(jsonb_build_object('entry_count',u.entry_count,'metadata',uc.metadata) order by u.sort_index) value
      from public.vocab_units u join public.vocab_unit_catalog uc on uc.unit_id=u.id where u.dataset_id=$1`, [prepared.datasetId]);
    expect(dbUnits.map(u => u.entry_count)).toEqual(units.map(u => u.occurrenceKeys.length));
    expect(dbUnits.map(u => u.metadata.librarySourceScopes.map(s => s.id).sort())).toEqual(units.map(u => [...u.scopeIds].sort()));
    expect(await scalar("select public.prepare_vocabulary_composition_v1($1,$2) value", [v.id, v.contentHash])).toEqual(prepared);
    expect(await scalar("select count(*)::int value from public.vocab_entries where dataset_id=$1", [originalDataset])).toBe(6);
  });
  it("rejects browser-provided question contents and changed generated choices without partial publication", async () => {
    const v = template.versions[0]!;
    const questions = planCompositionQuestions(prepared); expect(questions).toHaveLength(12);
    await expect(db.query("select public.finalize_vocabulary_composition_v1($1,$2,$3::jsonb)", [v.id, v.contentHash, JSON.stringify(questions)])).rejects.toThrow(/permission denied/);
    await service();
    const changed = structuredClone(questions); changed[0]!.choices[0] = "바꾼 보기";
    await expect(db.query("select public.finalize_vocabulary_composition_v1($1,$2,$3::jsonb)", [v.id, v.contentHash, JSON.stringify(changed)])).rejects.toThrow("composition_choice_text_changed");
    await admin(); expect(await scalar("select status value from public.vocab_datasets where id=$1", [prepared.datasetId])).toBe("pending_review");
  });
  it("publishes the existing generator's frozen question bank once and preserves rows/resources", async () => {
    const v = template.versions[0]!; await service();
    const summary = compositionCompletionSummarySchema.parse(await scalar("select public.finalize_vocabulary_composition_summary_v1($1,$2,$3::jsonb) value", [v.id, v.contentHash, JSON.stringify(planCompositionQuestions(prepared))]));
    expect(summary).toEqual({ versionId: v.id, datasetId: prepared.datasetId, contentHash: v.contentHash, state: "ready", entryCount: 6, questionCount: 12 });
    prepared = compositionPreparationSchema.parse(await scalar("select public.finalize_vocabulary_composition_v1($1,$2,'[]') value", [v.id, v.contentHash]));
    expect(prepared.state).toBe("ready");
    expect(await scalar("select public.finalize_vocabulary_composition_v1($1,$2,'[]') value", [v.id, v.contentHash])).toEqual(prepared);
    await admin(); const catalog = libraryCatalogSchema.parse(await scalar("select public.list_vocabulary_library_v1() value"));
    expect(catalog.templates[0]!.versions[0]!.datasetId).toBe(prepared.datasetId);
    await db.exec("reset role");
    expect(await scalar("select count(*)::int value from private.vocabulary_composition_items where version_id=$1", [v.id])).toBe(12);
    await expect(db.query("update public.vocab_entries set pronunciation_ko='변경' where dataset_id=$1", [prepared.datasetId])).rejects.toThrow("immutable");
    await expect(db.query("update private.vocabulary_composition_items set prompt='변경' where version_id=$1", [v.id])).rejects.toThrow("immutable");
    await admin();
  });
  async function bankPlan() {
    const units = await scalar<string[]>("select jsonb_agg(id order by sort_index) value from public.vocab_units where dataset_id=$1", [prepared.datasetId]);
    const rows = (await db.query<{ vocab_entry_id: number; question_item_id: string; question_item_sha256: string; direction: string }>(
      "select * from public.list_active_vocabulary_composition_questions_v1($1,$2::uuid[],'book_meaning_choice')", [prepared.datasetId, units])).rows.filter(q => q.direction === "english_to_korean");
    return { units, questions: rows.map((q, index) => ({ vocab_entry_id: q.vocab_entry_id, base_order_index: index + 1, direction: q.direction,
      composition_bank: { mode: "book_meaning_choice", version_id: prepared.versionId, content_sha256: prepared.contentHash, question_item_id: q.question_item_id, question_item_sha256: q.question_item_sha256 } })) };
  }
  it("keeps the smaller preparation and completion APIs behind the original role boundaries", async () => {
    const v = template.versions[0]!;
    const command = JSON.stringify({ action: "materialize", requestId: randomUUID(), templateId: template.id, versionId: v.id, contentHash: v.contentHash });
    await db.exec("reset role; set role anon");
    await expect(db.query("select public.prepare_vocabulary_template_question_input_v1($1::jsonb)", [command])).rejects.toThrow(/permission denied/);
    await expect(db.query("select public.finalize_vocabulary_composition_summary_v1($1,$2,'[]')", [v.id, v.contentHash])).rejects.toThrow(/permission denied/);
    await db.exec(`reset role; set role authenticated; select set_config('request.jwt.claim.sub','${studentId}',false);`);
    await expect(db.query("select public.prepare_vocabulary_template_question_input_v1($1::jsonb)", [command])).rejects.toThrow("admin_required");
    await admin();
    await expect(db.query("select public.finalize_vocabulary_composition_summary_v1($1,$2,'[]')", [v.id, v.contentHash])).rejects.toThrow(/permission denied/);
    await service();
    await expect(db.query("select public.prepare_vocabulary_template_question_input_v1($1::jsonb)", [command])).rejects.toThrow(/permission denied/);
    await admin();
  });
  it("creates an actual direct assignment through the public retry-preserving entry point", async () => {
    const plan = await bankPlan(); expect(plan.questions).toHaveLength(6);
    const assignment = await scalar<string>(`select public.create_assignment_with_delivery_v7('가짜 새 조합 시험',$1::uuid,$2::uuid[],$3::int,100::smallint,300,80::smallint,false,null,'fixed',null,array['${studentId}']::uuid[],'none',null,$4::jsonb) value`,
      [prepared.datasetId, plan.units, plan.questions.length, JSON.stringify(plan.questions)]);
    const stored = await scalar<{ status: string; provenance: string; count: number }>(`select jsonb_build_object('status',a.status,'provenance',a.provenance_status,
      'count',(select count(*) from public.assignment_questions q where q.assignment_id=a.id)) value from public.assignments a where a.id=$1`, [assignment]);
    expect(stored).toEqual({ status: "active", provenance: "composition_verified_v1", count: 6 });
    const resources = await scalar<unknown[]>("select jsonb_agg(composition_pronunciation_snapshot->'target') value from public.assignment_questions where assignment_id=$1", [assignment]);
    expect(resources).toEqual(Array.from({ length: 6 }, () => emptyPronunciation));
  });
  it("refuses missing composition proof instead of falling through to the old writer", async () => {
    const plan = await bankPlan(); const before = await scalar("select count(*)::int value from public.assignments");
    const targets = plan.questions.map(q => ({ vocab_entry_id: q.vocab_entry_id, base_order_index: q.base_order_index, direction: q.direction }));
    await expect(db.query(`select public.create_assignment_with_delivery_v7('가짜 잘못된 시험',$1::uuid,$2::uuid[],$3::int,100::smallint,300,80::smallint,false,null,'fixed',null,array['${studentId}']::uuid[],'none',null,$4::jsonb)`,
      [prepared.datasetId, plan.units, targets.length, JSON.stringify(targets)])).rejects.toThrow("composition_assignment_payload_not_id_only");
    expect(await scalar("select count(*)::int value from public.assignments")).toBe(before);
  });
  it("preserves reviewed source questions and outside choice resources after partial selection and source retirement", async () => {
    await db.exec("reset role");
    const fixture = reviewedExamFixture(), voice = fixture.voice;
    const priorId = await scalar<string>("insert into public.vocab_datasets(dataset_key,title,source_label,source_sha256,row_count) values($1,'가짜 이전 학교 자료','fake',$2,278) returning id value", [voice.dataset_key, voice.dataset_source_sha256]);
    const priorUnit = await scalar<string>("insert into public.vocab_units(dataset_id,unit_label,normalized_label,unit_kind,sort_index,entry_count) values($1,'이전 범위','prior','supplement',1,278) returning id value", [priorId]);
    await db.query("insert into public.vocab_dataset_catalog(dataset_id,display_name,catalog_group,material_kind,is_assignable) values($1,'가짜 학교','high','exam_prep',false)", [priorId]);
    await db.query(`insert into public.vocab_entries(dataset_id,source_row,row_sha256,headword,headword_normalized,meanings,primary_meaning,unit_id,position_in_unit,entry_type)
      select $1,r.source_row,r.entry_row_sha256,r.headword,r.headword_normalized,array['가짜'],'가짜',$3,r.source_row,'word'
      from jsonb_to_recordset($2::jsonb) r(source_row int,entry_row_sha256 text,headword text,headword_normalized text)`, [priorId, JSON.stringify(voice.bindings), priorUnit]);
    await db.exec(`select set_config('request.jwt.claim.role','authenticated',false);`);
    const rpc = (name: string, ...args: unknown[]) => scalar(`select public.${name}(${args.map((_, i) => "$" + (i + 1)).join(",")}) value`, args.map(a => typeof a === "string" ? a : JSON.stringify(a)));
    await rpc("stage_school_pronunciation_release_v1", vocabPronunciationReleaseHeader(voice as never));
    await rpc("import_vocab_pronunciation_identity_batch_v3", voice.release_id, voice.identities);
    await rpc("import_vocab_pronunciation_binding_batch_v3", voice.release_id, voice.bindings);
    await rpc("verify_vocab_pronunciation_release_v3", voice.release_id); await rpc("activate_vocab_pronunciation_release_v3", voice.release_id);
    await db.query("insert into private.reviewed_exam_import_approvals values('wojxpruvbjzbhrpmsbuy',$1,$2,$3,278,1112,'fake-composition-reviewed')", [fixture.fileHash, fixture.bundle.content_sha256, fixture.bundle.dataset.key]);
    const original = await scalar<{ dataset_id: string; release_id: string }>("select private.import_reviewed_exam_bundle_v1($1) value", [fixture.text]);
    await db.query("select private.activate_reviewed_exam_release_v1($1,$2)", [original.release_id, fixture.bundle.content_sha256]);
    const sourceRows = (await db.query<{ id: number; unit_id: string; source_row: number; row_hash: string; headword: string; definition: string }>(
      "select e.id,e.unit_id,e.source_row,lower(e.row_sha256) row_hash,e.headword,e.english_definition definition from public.vocab_entries e where e.dataset_id=$1 order by e.source_row", [original.dataset_id])).rows;
    const groups = new Map<string, typeof sourceRows>();
    for (const row of sourceRows) { const key = [1, 2, 3, 5].includes(row.source_row) ? "selected" : row.unit_id; groups.set(key, [...(groups.get(key) ?? []), row]); }
    const bundle = { schemaVersion: "vocabulary-library-import-v1", sourceCatalogHash: hash("school-scopes"), linksHash: hash("school-links"), referenceCatalogHash: hash("school-files"),
      scopes: [...groups].map(([key, rows]) => ({ key: `reviewed-${key}`, name: key === "selected" ? "학교 자료 일부" : "학교 자료 나머지", sourceTitle: "가짜 검토 학교 자료",
        source: { datasetId: original.dataset_id, unitId: rows[0]!.unit_id, kind: "reviewed_exam", releaseId: original.release_id, releaseVersion: fixture.bundle.content_sha256, fileHash: fixture.fileHash, locator: "school-fixture.json" },
        classification: { kind: "school", sourceGrade: "g11", exam: null, lesson: null, day: null, publisher: null, school: "가짜학교", targetGrade: "g11", schoolYear: 2026, semester: 2, assessment: "수행평가", purpose: "직전 대비" },
        rows: rows.map(r => ({ sourceRow: r.source_row, rowHash: r.row_hash, resources: { entryHash: r.row_hash, linkRecordHash: hash(`school:${r.source_row}`),
          selected: { ...resource, definitionEn: r.definition, pronunciation: { displayKo: "고정", segments: [{ text: "고정", stress: "primary" }], variantId: `fake:${r.id}`,
            audioUrl: `https://media.merriam-webster.com/audio/prons/en/us/mp3/a/fake${r.id}.mp3`, available: true } } } })) })) };
    const input = JSON.stringify(bundle), contentHash = await scalar<string>("select private.reviewed_exam_sha256_v1($1::jsonb) value", [input]);
    await db.query("insert into private.vocabulary_library_import_approvals values('wojxpruvbjzbhrpmsbuy',$1,$2,$3,'fake-reviewed-scopes')", [hash(input), contentHash, bundle.scopes.length]);
    await service(); await db.query("select public.import_vocabulary_library_v1($1)", [input]); await admin();
    const scopes = libraryCatalogSchema.parse(await scalar("select public.list_vocabulary_library_v1() value")).scopes;
    const selected = scopes.find(s => s.name === "학교 자료 일부")!;
    const saved = libraryCommandResultSchema.parse(await scalar("select public.save_vocabulary_library_template_v1($1::jsonb) value", [JSON.stringify({ action: "create", requestId: randomUUID(), metadata: template.metadata,
      recipe: { filters: EMPTY_LIBRARY_FILTERS, scopes: [{ id: selected.id, version: selected.version }], excludedOccurrenceKeys: [], scopeStatus: "confirmed" } })])).template;
    const version = saved.versions[0]!;
    const prep = compositionPreparationSchema.parse(await scalar("select public.prepare_vocabulary_composition_v1($1,$2) value", [version.id, version.contentHash]));
    schoolPrepared = prep;
    expect(prep.entries).toHaveLength(4); expect(planCompositionQuestions(prep)).toHaveLength(0);
    await service(); await db.query("select public.finalize_vocabulary_composition_v1($1,$2,'[]')", [version.id, version.contentHash]); await db.exec("reset role");
    const items = (await db.query<{ preserved: boolean; outside: boolean; pronunciation_snapshot: { choices: unknown[] } }>(`select i.prompt=o.prompt and i.choice_texts=o.choice_texts and i.correct_choice_index=o.correct_choice_index preserved,
      exists(select 1 from unnest(i.choice_vocab_entry_ids)x where x not in(select vocab_entry_id from private.vocabulary_composition_entries where version_id=$1)) outside,i.pronunciation_snapshot
      from private.vocabulary_composition_items i join private.reviewed_exam_items o on o.release_id=i.source_release_id and o.item_id=i.source_item_id where i.version_id=$1`, [version.id])).rows;
    expect(items).toHaveLength(16); expect(items.every(i => i.preserved && i.pronunciation_snapshot.choices.length === 4)).toBe(true); expect(items.some(i => i.outside)).toBe(true);
    await db.query("update private.reviewed_exam_releases set status='retired' where release_id=$1", [original.release_id]);
    await db.query("update public.vocab_datasets set status='retired',is_active=false where id=$1", [original.dataset_id]);
    await admin();
    const units = [...new Set(prep.entries.map(e => e.unitId))];
    const rows = (await db.query<{ vocab_entry_id: number; question_item_id: string; question_item_sha256: string }>("select * from public.list_active_vocabulary_composition_questions_v1($1,$2::uuid[],'canonical_headword_to_definition')", [prep.datasetId, units])).rows;
    const questions = rows.map((q, i) => ({ vocab_entry_id: q.vocab_entry_id, base_order_index: i + 1, direction: "english_to_korean", composition_bank: { mode: "canonical_headword_to_definition", version_id: version.id, content_sha256: version.contentHash, question_item_id: q.question_item_id, question_item_sha256: q.question_item_sha256 } }));
    const assignment = await scalar<string>(`select public.create_assignment_with_delivery_v7('가짜 학교 고정 문항',$1::uuid,$2::uuid[],4,100::smallint,300,80::smallint,false,null,'fixed',null,array['${studentId}']::uuid[],'none',null,$3::jsonb) value`, [prep.datasetId, units, JSON.stringify(questions)]);
    schoolAssignment = assignment;
    await service(); const study = await scalar<{ words: { entryId: number; compositionPronunciation: { displayKo: string } }[] }>("select public.get_student_assignment_study_v1($1,$2) value", [studentId, assignment]);
    expect(study.words).toHaveLength(4); expect(study.words.every(w => w.compositionPronunciation.displayKo === "고정")).toBe(true);
    expect(JSON.stringify(study)).not.toMatch(/choice_texts|correct_choice_index|choices/);
    await admin();
  });
  it("keeps the exact mode, text, outside choices, and voice after a regular settings edit", async () => {
    const snapshot = async (assignment: string) => (await db.query<{ vocab_entry_id: number; base_order_index: number; direction: string; choice_vocab_entry_ids: number[] }>("select vocab_entry_id,base_order_index,direction,prompt,choices,choice_vocab_entry_ids,correct_choice_index,composition_pronunciation_snapshot from public.assignment_questions where assignment_id=$1 order by base_order_index", [assignment])).rows;
    const before = await snapshot(schoolAssignment);
    const plan = before.map(({ vocab_entry_id, base_order_index, direction, choice_vocab_entry_ids }) => ({ vocab_entry_id, base_order_index, direction, choice_vocab_entry_ids }));
    const changed = await scalar<{ replacementAssignmentId: string }>(`select public.replace_student_assignment_v7($1::uuid,'${studentId}',$2::uuid,$3,'regular','none','가짜 수정',$4::uuid,$5::uuid[],4,100::smallint,300,85::smallint,false,null,'fixed',null,null,'none',null,'{}'::smallint[],'dataset','{}'::uuid[],$6::jsonb) value`, [schoolAssignment, randomUUID(), hash("regular-frozen-edit"), schoolPrepared.datasetId, [...new Set(schoolPrepared.entries.map(e => e.unitId))], JSON.stringify(plan)]);
    expect(await snapshot(changed.replacementAssignmentId)).toEqual(before);
    expect(await scalar("select quiz_content_mode value from public.assignments where id=$1", [changed.replacementAssignmentId])).toBe("canonical_headword_to_definition");
    schoolAssignment = changed.replacementAssignmentId;
  });
  it.each([1, 3])("keeps %i exact wrong words and outside choices through queue linking, editing, rollback, and retry", async count => {
    await db.exec("reset role");
    await db.query("update public.assignments set status='closed' where dataset_id=$1 and status='active'", [schoolPrepared.datasetId]);
    const ids = schoolPrepared.entries.map(e => e.id);
    const choices = (await db.query<{ vocab_entry_id: number; direction: string; choice_vocab_entry_ids: number[] }>("select * from public.list_vocabulary_composition_review_choices_v1($1,$2::bigint[])", [schoolPrepared.datasetId, ids])).rows.filter(q => q.direction === "english_to_korean");
    expect(choices).toHaveLength(4);
    const plan = choices.slice(0, count).map((q, index) => ({ ...q, base_order_index: index + 1 }));
    const source = await scalar<string>(`select private.create_exact_review_assignment_with_delivery_v1('가짜 오답 출처',$1::uuid,$2::uuid[],4,100::smallint,300,80::smallint,'fixed',null,array['${studentId}']::uuid[],'none',null,$3::jsonb) value`, [schoolPrepared.datasetId, [...new Set(schoolPrepared.entries.map(e => e.unitId))], JSON.stringify(choices.map((q, i) => ({ ...q, base_order_index: i + 1 })))]);
    const attempt = await scalar<string>("select public.create_quiz_attempt_from_bank($1,$2) value", [studentId, source]);
    const queueIds: string[] = [];
    for (const q of plan) queueIds.push(await scalar<string>(`insert into public.student_vocab_review_queue(student_id,dataset_id,vocab_entry_id,source_attempt_id,source_question_id,reason_level,status,queued_by)
      select $1,$2,$3,$4,qq.id,1,'pending',$5 from public.quiz_questions qq where qq.attempt_id=$4 and qq.vocab_entry_id=$3 returning id value`, [studentId, schoolPrepared.datasetId, q.vocab_entry_id, attempt, adminId]));
    await db.query("update public.assignments set status='closed' where id=$1", [source]);
    const original = await scalar<string>(`select private.create_exact_review_assignment_v5($1::uuid,$2::uuid,$3::uuid[],'가짜 오답',100::smallint,300,80::smallint,'fixed',null,'none',null,$4::jsonb) value`, [studentId, schoolPrepared.datasetId, queueIds, JSON.stringify(plan)]);
    const snapshot = async (id: string) => (await db.query("select vocab_entry_id,base_order_index,direction,prompt,choices,choice_vocab_entry_ids,correct_choice_index,composition_pronunciation_snapshot from public.assignment_questions where assignment_id=$1 order by base_order_index", [id])).rows;
    const before = await snapshot(original);
    const sql = `select public.replace_student_assignment_v7($1::uuid,$2::uuid,$3::uuid,$4::text,'review','preserve','가짜 오답 수정',$5::uuid,'{}'::uuid[],$6::int,100::smallint,300,85::smallint,false,null,'fixed',null,null,'none',null,array[1]::smallint[],'dataset',$7::uuid[],$8::jsonb) value`;
    const altered = structuredClone(plan); [altered[0]!.choice_vocab_entry_ids[0], altered[0]!.choice_vocab_entry_ids[1]] = [altered[0]!.choice_vocab_entry_ids[1]!, altered[0]!.choice_vocab_entry_ids[0]!];
    await expect(db.query(sql, [original, studentId, randomUUID(), hash("bad-frozen-edit"), schoolPrepared.datasetId, count, queueIds, JSON.stringify(altered)])).rejects.toThrow();
    expect(await scalar("select status value from public.assignments where id=$1", [original])).toBe("active");
    const args = [original, studentId, randomUUID(), hash(`review-edit:${count}`), schoolPrepared.datasetId, count, queueIds, JSON.stringify(plan)];
    const result = await scalar<{ replacementAssignmentId: string }>(sql, args);
    const total = await scalar("select count(*)::int value from public.assignments");
    expect(await scalar(sql, args)).toEqual({ ...result, idempotent: true }); expect(await scalar("select count(*)::int value from public.assignments")).toBe(total);
    expect(await snapshot(result.replacementAssignmentId)).toEqual(before);
    const targetUnits = [...new Set(schoolPrepared.entries.filter(e => plan.some(q => q.vocab_entry_id === e.id)).map(e => e.unitId))].sort();
    expect(await scalar("select jsonb_agg(unit_id order by unit_id) value from public.assignment_units where assignment_id=$1", [result.replacementAssignmentId])).toEqual(targetUnits);
    // Release this fake reservation before the next independent review size.
    await db.query("update public.assignment_review_targets set released_at=now() where assignment_id=$1", [result.replacementAssignmentId]);
    await db.query("update public.student_vocab_review_queue set status='cancelled',cancelled_at=now() where id=any($1)", [queueIds]);
    await admin();
  });
  it("revalidates the original eligibility between preparation and publication", async () => {
    const copied = libraryCommandResultSchema.parse(await scalar("select public.save_vocabulary_library_template_v1($1::jsonb) value", [JSON.stringify({ action: "copy", requestId: randomUUID(), sourceVersionId: template.versions[0]!.id, metadata: template.metadata })])).template;
    const v = copied.versions[0]!;
    const pending = compositionPreparationSchema.parse(await scalar("select public.prepare_vocabulary_composition_v1($1,$2) value", [v.id, v.contentHash]));
    const questions = planCompositionQuestions(pending);
    await db.exec("reset role");
    await db.query("update public.vocab_entry_quiz_eligibility set status='excluded',reason_codes=array['meaning_missing'] where vocab_entry_id=$1", [pending.entries[0]!.sourceEntryId]);
    await service();
    await expect(db.query("select public.finalize_vocabulary_composition_v1($1,$2,$3::jsonb)", [v.id, v.contentHash, JSON.stringify(questions)])).rejects.toMatchObject({ code: "40001" });
    await db.exec("reset role");
    expect(await scalar("select state value from private.vocabulary_compositions where version_id=$1", [v.id])).toBe("preparing");
    await db.query("update public.vocab_entry_quiz_eligibility set status='eligible',reason_codes='{}' where vocab_entry_id=$1", [pending.entries[0]!.sourceEntryId]);
    await admin();
  });
  it("binds materialization requests and updates only book metadata across fixed versions", async () => {
    const v = template.versions[0]!;
    const request = { action: "materialize", requestId: randomUUID(), templateId: template.id, versionId: v.id, contentHash: v.contentHash };
    expect(await scalar("select public.prepare_vocabulary_template_book_v1($1::jsonb) value", [JSON.stringify(request)])).toMatchObject({ state: "ready", versionId: v.id });
    await expect(db.query("select public.prepare_vocabulary_template_book_v1($1::jsonb)", [JSON.stringify({ ...request, contentHash: "f".repeat(64) })])).rejects.toThrow("library_request_reused");
    await expect(db.query("select public.prepare_vocabulary_template_book_v1($1::jsonb)", [JSON.stringify({ ...request, requestId: randomUUID(), templateId: randomUUID() })])).rejects.toThrow("library_version_missing");
    const sourceTitles = await scalar("select jsonb_agg(title order by id) value from public.assignments where dataset_id=$1", [prepared.datasetId]);
    await scalar("select public.save_vocabulary_library_template_v1($1::jsonb) value", [JSON.stringify({ action: "metadata", requestId: randomUUID(), templateId: template.id, expectedRevision: template.revision, metadata: { ...template.metadata, title: "가짜 새 이름", school: "가짜학교", targetGrade: "g11", semester: 2 } })]);
    const summary = libraryCommandResultSchema.parse(await scalar("select public.get_vocabulary_composition_summary_v1($1) value", [v.id]));
    expect(summary.createdBook).toMatchObject({ contentHash: v.contentHash, dataset: { title: "가짜 새 이름", gradeCode: "g11", schoolName: "가짜학교", semester: 2 } });
    expect(await scalar("select title value from public.vocab_datasets where id=$1", [prepared.datasetId])).toBe("가짜 새 이름");
    expect(await scalar("select jsonb_build_object('name',display_name,'school',metadata->'school','semester',metadata->'semester') value from public.vocab_dataset_catalog where dataset_id=$1", [prepared.datasetId]))
      .toEqual({ name: "가짜 새 이름", school: "가짜학교", semester: 2 });
    expect(await scalar("select jsonb_agg(title order by id) value from public.assignments where dataset_id=$1", [prepared.datasetId])).toEqual(sourceTitles);
    expect((await db.query("select * from public.list_vocabulary_unit_source_classifications_v1($1)", [prepared.datasetId])).rows).toEqual([]);
  });
  it("keeps historical full snapshots and their exact hashes readable, copyable and materializable", async () => {
    await db.exec("reset role");
    const legacy = await scalar<{ id: string; hash: string; templateId: string }>(`with original as (
      select recipe,private.resolve_vocabulary_library_recipe_v1(recipe) fixed from private.vocabulary_library_versions where id=$1
    ), t as (insert into private.vocabulary_library_templates(metadata,created_by) values($2::jsonb,$3) returning id),
    v as (insert into private.vocabulary_library_versions(template_id,number,content_sha256,recipe,fixed_composition,created_by)
      select t.id,1,private.reviewed_exam_sha256_v1(original.fixed),original.recipe,original.fixed,$3 from t,original returning *)
    select jsonb_build_object('id',id,'hash',content_sha256,'templateId',template_id) value from v`, [template.versions[0]!.id, JSON.stringify(template.metadata), adminId]);
    await admin();
    const copied = libraryCommandResultSchema.parse(await scalar("select public.save_vocabulary_library_template_v1($1::jsonb) value", [JSON.stringify({
      action: "copy", requestId: randomUUID(), sourceVersionId: legacy.id, metadata: template.metadata,
    })])).template.versions[0]!;
    expect(copied.contentHash).toBe(legacy.hash);
    const legacyPrepared = compositionPreparationSchema.parse(await scalar("select public.prepare_vocabulary_composition_v1($1,$2) value", [legacy.id, legacy.hash]));
    expect(legacyPrepared.entries.map(e => [e.headword, e.primaryMeaning, e.sourceEntryId, e.resources])).toEqual(prepared.entries.map(e => [e.headword, e.primaryMeaning, e.sourceEntryId, e.resources]));
    await service();
    expect(await scalar("select public.finalize_vocabulary_composition_v1($1,$2,$3::jsonb) value", [legacy.id, legacy.hash, JSON.stringify(planCompositionQuestions(legacyPrepared))])).toMatchObject({ state: "ready", contentHash: legacy.hash });
    await db.exec("reset role");
    expect(await scalar("select a.fixed_composition=b.fixed_composition value from private.vocabulary_library_versions a,private.vocabulary_library_versions b where a.id=$1 and b.id=$2", [legacy.id, copied.id])).toBe(true);
    await db.exec("begin");
    try {
      await db.query("update public.vocab_entries set pronunciation_ko='변경 검출용' where id=$1", [prepared.entries[0]!.sourceEntryId]);
      await expect(db.query("select private.assert_vocabulary_library_version_current_v1(v) from private.vocabulary_library_versions v where id=$1", [legacy.id])).rejects.toThrow("library_scope_changed");
    } finally { await db.exec("rollback"); }
  });
  describe.sequential("database-owner verification without a browser identity", () => {
    const project = "wojxpruvbjzbhrpmsbuy", approval = "fake-management-verification", requestId = randomUUID();
    let version: LibraryTemplate["versions"][number], management: CompositionPreparation, questionsText: string, questionsHash: string;
    const owner = () => db.exec("reset role; select set_config('request.jwt.claim.sub','',false); select set_config('request.jwt.claim.role','',false); select set_config('request.jwt.claims','{}',false);");
    const prepareSql = "select private.prepare_vocabulary_composition_management_v1($1,$2,$3,$4,$5) value";
    const finishSql = "select private.finish_vocabulary_composition_management_v1($1,$2) value";
    const preserved = () => scalar(`select jsonb_build_object('source',(select jsonb_agg(to_jsonb(e) order by id) from public.vocab_entries e where dataset_id='${originalDataset}'),
      'students',(select jsonb_agg(to_jsonb(s) order by id) from public.students s),'assignments',(select jsonb_agg(to_jsonb(a) order by id) from public.assignments a),
      'attempts',(select jsonb_agg(to_jsonb(q) order by id) from public.quiz_attempts q)) value`);
    it("requires an exact approved version and keeps app roles out of management and core functions", async () => {
      await admin();
      version = libraryCommandResultSchema.parse(await scalar("select public.save_vocabulary_library_template_v1($1::jsonb) value", [JSON.stringify({
        action: "copy", requestId: randomUUID(), sourceVersionId: template.versions[0]!.id, metadata: template.metadata,
      })])).template.versions[0]!;
      await owner();
      await expect(db.query(prepareSql, [project, approval, requestId, version.id, version.contentHash])).rejects.toThrow("composition_management_not_approved");
      await db.query("insert into private.vocabulary_composition_management_approvals(project_ref,approval_id,version_id,content_sha256) values($1,$2,$3,$4)", [project, approval, version.id, version.contentHash]);
      await expect(db.query(prepareSql, ["x".repeat(20), approval, requestId, version.id, version.contentHash])).rejects.toThrow("composition_management_not_approved");
      await expect(db.query(prepareSql, [project, approval, requestId, version.id, "f".repeat(64)])).rejects.toThrow("composition_management_not_approved");
      for (const role of ["anon", "authenticated", "service_role"]) {
        await db.exec(`set role ${role}`);
        await expect(db.query(prepareSql, [project, approval, requestId, version.id, version.contentHash])).rejects.toThrow(/permission denied/);
        await expect(db.query("select private.prepare_vocabulary_composition_core_v1($1,$2,null,null)", [version.id, version.contentHash])).rejects.toThrow(/permission denied/);
        await expect(db.query("select private.prepare_vocabulary_composition_data_v1($1,$2,null,null)", [version.id, version.contentHash])).rejects.toThrow(/permission denied/);
        await expect(db.query("select private.vocabulary_composition_question_input_v1($1)", [version.id])).rejects.toThrow(/permission denied/);
        await expect(db.query("select private.finalize_vocabulary_composition_core_v1($1,$2,'[]',true)", [version.id, version.contentHash])).rejects.toThrow(/permission denied/);
        await expect(db.query("select * from private.vocabulary_composition_management_inputs")).rejects.toThrow(/permission denied/);
        await owner();
      }
      expect(await scalar("select count(*)::int value from private.vocabulary_composition_management_requests")).toBe(0);
    });
    it("records the real database actor without an admin identity and preserves original/student data", async () => {
      const before = await preserved();
      const result = await scalar(prepareSql, [project, approval, requestId, version.id, version.contentHash]);
      expect(result).toMatchObject({ versionId: version.id, contentHash: version.contentHash, state: "preparing", entryCount: 6, questionCount: 0 });
      expect(await scalar(prepareSql, [project, approval, requestId, version.id, version.contentHash])).toEqual(result);
      management = compositionPreparationSchema.parse(await scalar("select private.vocabulary_composition_preparation_v1($1) value", [version.id]));
      expect(management.entries.map(e => e.headword)).toEqual(prepared.entries.map(e => e.headword));
      expect(await scalar(`select jsonb_build_object('author',c.created_by,'request',c.management_request_id,'importer',d.imported_by,'actor',r.executed_by,'session',r.session_role) value
        from private.vocabulary_compositions c join public.vocab_datasets d on d.id=c.dataset_id join private.vocabulary_composition_management_requests r on r.id=c.management_request_id where c.version_id=$1`, [version.id]))
        .toEqual({ author: null, request: requestId, importer: null, actor: "postgres", session: "postgres" });
      expect(await preserved()).toEqual(before);
      await expect(db.query(prepareSql, [project, approval, randomUUID(), version.id, version.contentHash])).rejects.toThrow("composition_management_owner_changed");
      await expect(db.query("update private.vocabulary_compositions set created_by=$1 where version_id=$2", [adminId, version.id])).rejects.toThrow("composition_author_immutable");
      await expect(db.query("update private.vocabulary_composition_management_requests set approval_id='changed' where id=$1", [requestId])).rejects.toThrow("immutable");
    });
    it("rejects missing, changed, and incomplete transport before publishing any question", async () => {
      questionsText = JSON.stringify(planCompositionQuestions(management)); questionsHash = hash(questionsText);
      await expect(db.query(finishSql, [requestId, questionsHash])).rejects.toThrow("composition_management_input_changed");
      await db.query("insert into private.vocabulary_composition_management_inputs(request_id,file_sha256,byte_count,question_count) values($1,$2,$3,12)", [requestId, questionsHash, Buffer.byteLength(questionsText)]);
      await expect(db.query(finishSql, [requestId, questionsHash])).rejects.toThrow("composition_questions_incomplete");
      const midpoint = Math.floor(questionsText.length / 2);
      await db.query("select private.stage_vocabulary_composition_questions_v1($1,1,2,$2)", [requestId, questionsText.slice(0, midpoint)]);
      await db.query("select private.stage_vocabulary_composition_questions_v1($1,1,2,$2)", [requestId, questionsText.slice(0, midpoint)]);
      await expect(db.query("select private.stage_vocabulary_composition_questions_v1($1,1,2,'changed')", [requestId])).rejects.toThrow("composition_question_chunk_changed");
      await expect(db.query(finishSql, [requestId, questionsHash])).rejects.toThrow("composition_questions_incomplete");
      await db.query("select private.stage_vocabulary_composition_questions_v1($1,2,2,$2)", [requestId, questionsText.slice(midpoint)]);
      await service();
      await expect(db.query("select public.finalize_vocabulary_composition_v1($1,$2,$3::jsonb)", [version.id, version.contentHash, questionsText])).rejects.toThrow("composition_management_completion_required");
      await expect(db.query("select public.finalize_vocabulary_composition_summary_v1($1,$2,$3::jsonb)", [version.id, version.contentHash, questionsText])).rejects.toThrow("composition_management_completion_required");
      await owner();
      await expect(db.query(finishSql, [requestId, "f".repeat(64)])).rejects.toThrow("composition_management_input_changed");
      expect(await scalar("select state value from private.vocabulary_compositions where version_id=$1", [version.id])).toBe("preparing");
      expect(await scalar("select count(*)::int value from private.vocabulary_composition_items where version_id=$1", [version.id])).toBe(0);
      await expect(db.query("update private.vocabulary_composition_management_inputs set question_count=1 where request_id=$1", [requestId])).rejects.toThrow("immutable");
    });
    it("uses the unchanged question validator and makes successful retries independent of deleted chunks", async () => {
      const before = await preserved();
      await db.exec("begin");
      try {
        await db.query("update private.vocabulary_compositions set state='ready',question_sha256=repeat('a',64) where version_id=$1", [version.id]);
        await expect(db.query(finishSql, [requestId, questionsHash])).rejects.toThrow("composition_management_unrecorded_completion");
      } finally { await db.exec("rollback"); }
      const result = await scalar(finishSql, [requestId, questionsHash]);
      expect(result).toMatchObject({ versionId: version.id, datasetId: management.datasetId, state: "ready", entryCount: 6, questionCount: 12 });
      expect(await scalar("select count(*)::int value from private.vocabulary_composition_management_chunks where request_id=$1", [requestId])).toBe(0);
      expect(await scalar(finishSql, [requestId, questionsHash])).toEqual(result);
      await expect(db.query("select private.stage_vocabulary_composition_questions_v1($1,1,1,$2)", [requestId, questionsText])).rejects.toThrow("composition_questions_already_finished");
      expect(await scalar("select count(*)::int value from private.vocabulary_composition_management_chunks where request_id=$1", [requestId])).toBe(0);
      await expect(db.query(finishSql, [requestId, "f".repeat(64)])).rejects.toThrow("composition_management_input_changed");
      expect(await scalar("select is_assignable value from public.vocab_dataset_catalog where dataset_id=$1", [management.datasetId])).toBe(true);
      expect(await preserved()).toEqual(before);
      await expect(db.query("delete from private.vocabulary_composition_management_results where request_id=$1", [requestId])).rejects.toThrow("immutable");
    });
    it("rejects a six-version approval set and rolls back an unconfirmed scope with no orphan book", async () => {
      await db.exec("begin");
      try {
        const versions: typeof version[] = [];
        await admin();
        for (let i = 0; i < 6; i++) versions.push(libraryCommandResultSchema.parse(await scalar("select public.save_vocabulary_library_template_v1($1::jsonb) value", [JSON.stringify({
          action: "copy", requestId: randomUUID(), sourceVersionId: template.versions[0]!.id, metadata: template.metadata,
        })])).template.versions[0]!);
        await owner();
        for (const v of versions) await db.query("insert into private.vocabulary_composition_management_approvals(project_ref,approval_id,version_id,content_sha256) values($1,'fake-too-many',$2,$3)", [project, v.id, v.contentHash]);
        await db.exec("savepoint capacity");
        await expect(db.query(prepareSql, [project, "fake-too-many", randomUUID(), versions[0]!.id, versions[0]!.contentHash])).rejects.toThrow("composition_management_capacity");
        await db.exec("rollback to savepoint capacity");
        expect(await scalar("select count(*)::int value from private.vocabulary_composition_management_requests where approval_id='fake-too-many'")).toBe(0);
      } finally { await db.exec("rollback"); }
      await admin();
      const empty = libraryCommandResultSchema.parse(await scalar("select public.save_vocabulary_library_template_v1($1::jsonb) value", [JSON.stringify({ action: "create", requestId: randomUUID(), metadata: template.metadata,
        recipe: { filters: EMPTY_LIBRARY_FILTERS, scopes: [], excludedOccurrenceKeys: [], scopeStatus: "unconfirmed" } })])).template.versions[0]!;
      await owner();
      await db.query("insert into private.vocabulary_composition_management_approvals(project_ref,approval_id,version_id,content_sha256) values($1,'fake-unconfirmed',$2,$3)", [project, empty.id, empty.contentHash]);
      const before = await scalar("select count(*)::int value from public.vocab_datasets");
      await expect(db.query(prepareSql, [project, "fake-unconfirmed", randomUUID(), empty.id, empty.contentHash])).rejects.toThrow("composition_scope_unconfirmed");
      expect(await scalar("select count(*)::int value from public.vocab_datasets")).toBe(before);
      expect(await scalar("select count(*)::int value from private.vocabulary_composition_management_requests where approval_id='fake-unconfirmed'")).toBe(0);
    });
  });
});
