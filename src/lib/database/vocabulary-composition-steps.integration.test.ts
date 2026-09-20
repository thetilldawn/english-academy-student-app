import { createHash, randomUUID } from "node:crypto";
import type { PGlite } from "@electric-sql/pglite";
import { beforeAll, afterAll, describe, it, expect } from "vitest";
import { createFinalSchemaDatabase } from "@/test-support/final-schema-database";
import { EMPTY_LIBRARY_FILTERS, libraryCatalogSchema, libraryCommandResultSchema, type LibraryTemplate } from "@/features/wordbook-compositions/contracts/library";
import { compositionQuestionInputSchema, compositionStepSchema } from "@/features/wordbook-compositions/contracts/library-materialization";

const adminId = "00000000-0000-4000-8000-000000008101", project = "wojxpruvbjzbhrpmsbuy";
const sha = (s: string) => createHash("sha256").update(s).digest("hex");
describe.sequential("bounded composition commits and publication", () => {
  let db: PGlite, template: LibraryTemplate, source: string, dataset: string;
  let questions: { vocabEntryId: number; direction: string; prompt: string; choices: string[]; choiceVocabEntryIds: number[]; correctChoiceIndex: number }[];
  let command: { action: string; requestId: string; templateId: string; versionId: string; contentHash: string };
  const scalar = async <T>(sql: string, args: unknown[] = []) => (await db.query<{ value: T }>(sql, args)).rows[0]!.value;
  const owner = () => db.exec("reset role; select set_config('request.jwt.claim.sub','',false); select set_config('request.jwt.claim.role','',false)");
  const admin = () => db.exec(`reset role; set role authenticated; select set_config('request.jwt.claim.sub','${adminId}',false); select set_config('request.jwt.claim.role','authenticated',false)`);
  const service = () => db.exec("reset role; set role service_role; select set_config('request.jwt.claim.role','service_role',false)");
  const advance = async () => compositionStepSchema.parse(await scalar("select public.advance_vocabulary_template_book_v1($1::jsonb) value", [JSON.stringify(command)]));
  const finish = async (payload: unknown = null) => compositionStepSchema.parse(await scalar("select public.advance_vocabulary_composition_questions_v1($1,$2,$3::jsonb) value", [command.versionId, command.contentHash, payload === null ? null : JSON.stringify(payload)]));
  const counts = () => scalar<{ rows: number; next: number; contexts: number; items: number; plans: number; status: string; assignable: boolean }>(`select jsonb_build_object(
    'rows',(select count(*) from public.vocab_entries where dataset_id=c.dataset_id),'next',b.next_row,
    'contexts',(select count(*) from private.vocabulary_composition_write_context),
    'items',(select count(*) from private.vocabulary_composition_items where version_id=c.version_id),
    'plans',(select count(*) from private.vocabulary_composition_question_plans where version_id=c.version_id),
    'status',d.status,'assignable',cat.is_assignable) value from private.vocabulary_compositions c
    join private.vocabulary_composition_builds b using(version_id,dataset_id) join public.vocab_datasets d on d.id=c.dataset_id
    join public.vocab_dataset_catalog cat on cat.dataset_id=c.dataset_id where c.version_id=$1`, [command.versionId]);
  beforeAll(async () => {
    db = await createFinalSchemaDatabase();
    await db.exec(`insert into auth.users(id) values('${adminId}'); insert into public.admin_profiles(user_id,display_name) values('${adminId}','가짜 관리자'); select set_config('request.jwt.claims','{"ref":"${project}"}',false)`);
    source = await scalar<string>("insert into public.vocab_datasets(dataset_key,title,source_label,source_sha256,row_count,status,is_active) values('fake-bounded-source','가짜 501행','fake',repeat('A',64),501,'ready',true) returning id value");
    const unit = await scalar<string>("insert into public.vocab_units(dataset_id,unit_label,normalized_label,unit_kind,unit_number,sort_index,entry_count) values($1,'DAY 1','day1','day',1,1,501) returning id value", [source]);
    await db.query("insert into public.vocab_dataset_catalog(dataset_id,display_name,catalog_group,material_kind) values($1,'가짜 자료','high','wordbook')", [source]);
    await db.query(`insert into public.vocab_entries(dataset_id,source_row,headword,headword_normalized,meanings,primary_meaning,row_sha256,unit_id,position_in_unit,entry_type)
      select $1,n,'sample'||n,'sample'||n,array['가짜 뜻 '||n],'가짜 뜻 '||n,upper(encode(extensions.digest('bounded:'||n,'sha256'),'hex')),$2,n,'word' from generate_series(1,501)n`, [source, unit]);
    await db.query(`insert into public.vocab_entry_quiz_eligibility(vocab_entry_id,dataset_id,quiz_mode,status,input_content_hash,rule_version,evaluated_at_utc)
      select id,dataset_id,'book_meaning_en_to_ko','eligible',row_sha256,'fake',now() from public.vocab_entries where dataset_id=$1`, [source]);
    const rows = (await db.query<{ source_row: number; row_hash: string }>("select source_row,lower(row_sha256) row_hash from public.vocab_entries where dataset_id=$1 order by source_row", [source])).rows;
    const selected = { schemaVersion: "vocabulary-resource-snapshot-v1", sourceFields: {}, proofs: {}, pronunciation: { displayKo: null, variantId: null, audioUrl: null, available: false }, lexicalPos: null, dictionary: null, senseId: null, definitionEn: null, exampleEn: null, exampleKo: null };
    const bundle = { schemaVersion: "vocabulary-library-import-v1", sourceCatalogHash: sha("catalog"), linksHash: sha("links"), referenceCatalogHash: sha("refs"), scopes: [{
      key: "bounded-501", name: "가짜 501행", sourceTitle: "가짜 자료", source: { datasetId: source, unitId: unit, kind: "legacy_vocab", releaseId: null, releaseVersion: "a".repeat(64), fileHash: sha("file"), locator: "fake.json" },
      classification: { kind: "wordbook", sourceGrade: "g11", exam: null, lesson: null, day: 1, publisher: null, school: null, targetGrade: null, schoolYear: null, semester: null, assessment: null, purpose: null },
      rows: rows.map(r => ({ sourceRow: r.source_row, rowHash: r.row_hash, resources: { entryHash: r.row_hash, linkRecordHash: sha(`row:${r.source_row}`), selected } })),
    }] };
    const text = JSON.stringify(bundle), hash = await scalar<string>("select private.reviewed_exam_sha256_v1($1::jsonb) value", [text]);
    await db.query("insert into private.vocabulary_library_import_approvals values($1,$2,$3,1,'fake-bounded')", [project, sha(text), hash]);
    await service(); await db.query("select public.import_vocabulary_library_v1($1)", [text]); await admin();
    const scopes = libraryCatalogSchema.parse(await scalar("select public.list_vocabulary_library_v1() value")).scopes;
    template = libraryCommandResultSchema.parse(await scalar("select public.save_vocabulary_library_template_v1($1::jsonb) value", [JSON.stringify({ action: "create", requestId: randomUUID(), metadata: { title: "가짜 501행", tags: [], school: null, targetGrade: null, schoolYear: null, semester: null, assessment: null, purpose: null }, recipe: { filters: EMPTY_LIBRARY_FILTERS, scopes: scopes.map(s => ({ id: s.id, version: s.version })), excludedOccurrenceKeys: [], scopeStatus: "confirmed" } })])).template;
    command = { action: "materialize", requestId: randomUUID(), templateId: template.id, versionId: template.versions[0]!.id, contentHash: template.versions[0]!.contentHash };
  }, 60000);
  afterAll(async () => { await db?.close(); });
  it("keeps the first 500 rows hidden and blocks every legacy preparation/finalization shortcut", async () => {
    const step = await advance(); dataset = step.datasetId;
    expect(step).toMatchObject({ state: "preparing", stage: "entries", done: 500, total: 501 });
    await expect(db.query("select public.prepare_vocabulary_template_question_input_v1($1::jsonb)", [JSON.stringify(command)])).rejects.toThrow("composition_preparation_incomplete");
    await service();
    await expect(db.query("select public.finalize_vocabulary_composition_summary_v1($1,$2,'[]')", [command.versionId, command.contentHash])).rejects.toThrow("composition_bounded_completion_required");
    await expect(finish([])).rejects.toThrow("composition_preparation_incomplete");
    await owner(); expect(await counts()).toMatchObject({ rows: 500, next: 501, contexts: 0, status: "pending_review", assignable: false });
    await db.exec(`create function public.fake_fail_last_row() returns trigger language plpgsql as $$begin if new.dataset_id='${dataset}' and new.source_row=501 then raise exception 'fake_last_row_failure'; end if; return new; end;$$;
      create trigger fake_last_row_failure after insert on public.vocab_entries for each row execute function public.fake_fail_last_row()`);
    await admin(); await expect(advance()).rejects.toThrow("fake_last_row_failure");
    await owner(); expect(await counts()).toMatchObject({ rows: 500, next: 501, contexts: 0 });
    await db.exec("drop trigger fake_last_row_failure on public.vocab_entries; drop function public.fake_fail_last_row()");
    await admin(); expect(await advance()).toMatchObject({ stage: "entries", done: 501 });
    expect(await advance()).toMatchObject({ stage: "prepared", done: 501 });
    const prep = compositionQuestionInputSchema.parse(await scalar("select public.prepare_vocabulary_template_question_input_v1($1::jsonb) value", [JSON.stringify(command)]));
    questions = prep.entries.map((e, i) => {
      const choices = Array.from({ length: 4 }, (_, j) => prep.entries[(i + j) % prep.entries.length]!);
      return { vocabEntryId: e.id, direction: "english_to_korean", prompt: e.headword, choices: choices.map(c => c.primaryMeaning), choiceVocabEntryIds: choices.map(c => c.id), correctChoiceIndex: 0 };
    });
  });
  it("rejects an invalid last question before freezing anything and permits the corrected plan", async () => {
    await service(); expect(await finish()).toMatchObject({ stage: "prepared", needsQuestions: true });
    for (const field of ["prompt", "choices", "correctChoiceIndex"] as const) {
      const bad = structuredClone(questions);
      if (field === "prompt") bad[500]!.prompt = "wrong";
      else if (field === "choices") bad[500]!.choices[3] = "wrong";
      else bad[500]!.correctChoiceIndex = 3;
      await expect(finish(bad)).rejects.toThrow(/composition_question_plan_/);
    }
    await owner(); expect(await counts()).toMatchObject({ plans: 0, items: 0, status: "pending_review" });
    await service(); expect(await finish(questions)).toMatchObject({ stage: "questions", done: 500, total: 501 });
    const changed = structuredClone(questions); changed.reverse();
    await expect(finish(changed)).rejects.toThrow("composition_question_plan_changed");
    await expect(db.query("select public.finalize_vocabulary_composition_summary_v1($1,$2,'[]')", [command.versionId, command.contentHash])).rejects.toThrow("composition_bounded_completion_required");
    expect(await finish()).toMatchObject({ stage: "questions", done: 501, state: "preparing" });
  });
  it("rechecks the source before publication, preserving committed chunks on conflict", async () => {
    await owner(); expect(await counts()).toMatchObject({ rows: 501, items: 501, status: "pending_review", assignable: false });
    await db.exec("begin");
    try {
      await db.query("update public.vocab_entries set pronunciation_ko='가짜 변경' where dataset_id=$1 and source_row=501", [source]);
      await service(); await expect(finish()).rejects.toThrow("library_scope_changed");
    } finally { await db.exec("rollback"); }
    await service(); expect(await finish()).toMatchObject({ state: "ready", stage: "complete" });
    expect(await finish()).toMatchObject({ state: "ready" });
    await owner(); expect(await counts()).toMatchObject({ rows: 501, items: 501, plans: 1, contexts: 0, status: "ready", assignable: true });
    const stored = await scalar("select jsonb_agg(jsonb_build_object('vocabEntryId',vocab_entry_id,'direction',direction,'prompt',prompt,'choices',choice_texts,'choiceVocabEntryIds',choice_vocab_entry_ids,'correctChoiceIndex',correct_choice_index) order by vocab_entry_id) value from private.vocabulary_composition_items where version_id=$1", [command.versionId]);
    expect(stored).toEqual([...questions].sort((a, b) => a.vocabEntryId - b.vocabEntryId));
    await admin(); expect(await advance()).toMatchObject({ state: "ready" });
  });
  it("does not expose private cursors or allow context spoofing from any application role", async () => {
    for (const role of ["anon", "authenticated", "service_role"]) {
      await db.exec(`reset role; set role ${role}; select set_config('vocabulary.composition.write_context','allow',false)`);
      await expect(db.query("select * from private.vocabulary_composition_write_context")).rejects.toThrow(/permission denied/);
      await expect(db.query("select private.insert_vocabulary_composition_question_batch_v1($1,'[]')", [command.versionId])).rejects.toThrow(/permission denied/);
      await expect(db.query("select private.advance_vocabulary_composition_build_v1($1,$2,null,null)", [command.versionId, command.contentHash])).rejects.toThrow(/permission denied/);
    }
    await owner(); await expect(db.query("update public.vocab_entries set pronunciation_ko='forged' where dataset_id=$1", [dataset])).rejects.toThrow("composition_content_immutable");
  });
  it("keeps management ownership, immutable input, and completion receipt atomic across several calls", async () => {
    await admin();
    const copy = libraryCommandResultSchema.parse(await scalar("select public.save_vocabulary_library_template_v1($1::jsonb) value", [JSON.stringify({ action: "copy", requestId: randomUUID(), sourceVersionId: command.versionId, metadata: template.metadata })])).template.versions[0]!;
    await owner(); const request = randomUUID(), approval = "fake-bounded-managed";
    await db.query("insert into private.vocabulary_composition_management_approvals(project_ref,approval_id,version_id,content_sha256) values($1,$2,$3,$4)", [project, approval, copy.id, copy.contentHash]);
    const advanceSql = "select private.advance_vocabulary_composition_management_v1($1,$2,$3,$4,$5) value";
    const args = [project, approval, request, copy.id, copy.contentHash];
    expect(await scalar(advanceSql, args)).toMatchObject({ stage: "entries", done: 500 });
    await expect(db.query(advanceSql, [project, approval, randomUUID(), copy.id, copy.contentHash])).rejects.toThrow("composition_management_owner_changed");
    expect(await scalar(advanceSql, args)).toMatchObject({ stage: "entries", done: 501 });
    expect(await scalar(advanceSql, args)).toMatchObject({ stage: "prepared" });
    const prep = compositionQuestionInputSchema.parse(await scalar("select private.vocabulary_composition_question_input_v1($1) value", [copy.id]));
    const ids = new Map(questions.map((q, i) => [q.vocabEntryId, prep.entries[i]!.id]));
    const text = JSON.stringify(questions.map(q => ({ ...q, vocabEntryId: ids.get(q.vocabEntryId), choiceVocabEntryIds: q.choiceVocabEntryIds.map(id => ids.get(id)) })));
    await db.query("insert into private.vocabulary_composition_management_inputs(request_id,file_sha256,byte_count,question_count) values($1,$2,$3,501)", [request, sha(text), Buffer.byteLength(text)]);
    await db.query("select private.stage_vocabulary_composition_questions_v1($1,1,1,$2)", [request, text]);
    const finishSql = "select private.advance_vocabulary_composition_management_questions_v1($1,$2) value";
    expect(await scalar(finishSql, [request, sha(text)])).toMatchObject({ stage: "questions", done: 500, state: "preparing" });
    expect(await scalar("select count(*)::int value from private.vocabulary_composition_management_results where request_id=$1", [request])).toBe(0);
    expect(await scalar("select count(*)::int value from private.vocabulary_composition_management_chunks where request_id=$1", [request])).toBe(1);
    await expect(db.query(finishSql, [request, "f".repeat(64)])).rejects.toThrow("composition_management_input_changed");
    await service(); await expect(db.query("select public.advance_vocabulary_composition_questions_v1($1,$2,null)", [copy.id, copy.contentHash])).rejects.toThrow("composition_management_completion_required");
    await owner(); expect(await scalar(finishSql, [request, sha(text)])).toMatchObject({ stage: "questions", done: 501 });
    const completed = await scalar(finishSql, [request, sha(text)]);
    expect(completed).toMatchObject({ state: "ready", entryCount: 501, questionCount: 501 });
    expect(await scalar(finishSql, [request, sha(text)])).toEqual(completed);
    expect(await scalar("select count(*)::int value from private.vocabulary_composition_management_chunks where request_id=$1", [request])).toBe(0);
    expect(await scalar("select count(*)::int value from private.vocabulary_composition_management_results where request_id=$1", [request])).toBe(1);
  });
});
