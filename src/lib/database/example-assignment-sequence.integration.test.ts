import { createHash } from "node:crypto";
import type { PGlite } from "@electric-sql/pglite";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterAll, afterEach, beforeAll, beforeEach, expect, it, vi } from "vitest";
import { createFinalSchemaDatabase } from "@/test-support/final-schema-database";
import type { AssignmentUnitItem } from "@/features/assignments/catalog-types";
import { createInitialVocabPlannerState, vocabPlannerReducer } from "@/features/assignments/controller/vocab-assignment-planner-state";
import { useVocabAssignmentDerivedPlan } from "@/features/assignments/controller/use-vocab-assignment-derived-plan";
import { createInitialBulkSeriesAssignmentDraft } from "@/features/assignments/domain/bulk-draft";
import { buildBulkAssignmentPreviewRequest, buildBulkAssignmentRequest } from "@/features/assignments/api/request-adapters";
import { bulkAssignmentPreviewSchema, bulkAssignmentSchema } from "@/features/assignments/contracts/bulk-assignment-request";
const mocks = vi.hoisted(() => ({ load: vi.fn(), client: vi.fn() }));
vi.mock("server-only", () => ({}));
vi.mock("@/features/assignments/server/queries/bulk-assignment-planning-query", () => ({ loadCommonBulkAssignmentPlanningData: mocks.load, loadSelectedVocabularyRowCount: async () => null }));
vi.mock("@/lib/supabase/server", () => ({ createServerSupabaseClient: mocks.client }));
import { resolveBulkAssignmentPreview } from "@/features/assignments/server/use-cases/bulk-assignment-preview";
import { createBulkAssignments } from "@/features/assignments/server/use-cases/bulk-assignment-command";

// Synthetic rows test the existing storage contract, not source-package approval
// or educational quality. No fixture is sent to an external database.
const id = (n: number) => `00000000-0000-4000-8000-${String(9900 + n).padStart(12, "0")}`;
const hash = (value: string) => createHash("sha256").update(value).digest("hex");
const common = hash("synthetic-a4-release"), datasetId = id(10), mode = "canonical_example_to_headword" as const;
const admin = { userId: id(1), displayName: "가짜 예문 관리자" };
let db: PGlite, units: AssignmentUnitItem[];
let savedBatches: Record<string, unknown>[];
const scalar = async <T>(sql: string, values: unknown[] = []) => (await db.query<{ value: T }>(sql, values)).rows[0]!.value;
async function insert(table: string, row: Record<string, unknown>) {
  const fields = Object.keys(row);
  await db.query(`insert into ${table}(${fields.join(",")}) values(${fields.map((_, i) => "$" + (i + 1)).join(",")})`,
    Object.values(row).map(v => v && typeof v === "object" && !Array.isArray(v) ? JSON.stringify(v) : v));
}
beforeAll(async () => {
  db = await createFinalSchemaDatabase();
  await db.exec(`insert into auth.users(id) values('${id(1)}');
    insert into public.admin_profiles(user_id,display_name) values('${id(1)}','가짜 관리자');
    insert into public.students(id,display_name,created_by) values('${id(2)}','가짜 예문 학생','${id(1)}');
    select set_config('request.jwt.claim.sub','${id(1)}',false);
    select set_config('request.jwt.claim.role','authenticated',false);
    select set_config('request.jwt.claims','{"role":"authenticated","ref":"wojxpruvbjzbhrpmsbuy"}',false);`);
  await insert("public.vocab_datasets", { id: datasetId, dataset_key: "a4-synthetic-examples", title: "가짜 예문12개", source_label: "synthetic", source_sha256: common.toUpperCase(), row_count: 12, status: "ready", is_active: true });
  const words = ["amber", "birch", "cabin", "dune", "elm", "fern", "grove", "harbor", "island", "jewel", "kettle", "ladder"];
  const entryIds: number[] = [];
  for (let i = 0; i < 3; i++) await insert("public.vocab_units", { id: id(50 + i), dataset_id: datasetId, unit_label: `DAY ${i + 1}`, normalized_label: `day-${i + 1}`, unit_kind: "day", unit_number: i + 1, sort_index: i + 1, entry_count: 4 });
  for (let i = 0; i < 12; i++) entryIds.push(await scalar<number>(`insert into public.vocab_entries(dataset_id,source_row,headword,headword_normalized,meanings,primary_meaning,row_sha256,unit_id,position_in_unit,entry_type)
    values($1,$2,$3,$3,$4,$5,$6,$7,$8,'word') returning id value`, [datasetId, i + 1, words[i], [`가짜 뜻${i}`], `가짜 뜻${i}`, hash("row" + i).toUpperCase(), id(50 + Math.floor(i / 4)), i % 4 + 1]));
  await insert("word_index.app_exam_use_release", { release_id: id(20), release_key: "a4-synthetic-exam", dataset_id: datasetId, dataset_key: "a4-synthetic-examples", schema_version: "1.0", package_version: common, source_sha256: common, candidate_dictionary_version: common, manifest_content_hash: common, exam_review_ledger_sha256: common, wordbook_id: "a4-fake", title: "가짜 시험용 어휘", target_environment: "preview", common_dictionary_release_allowed: false, exam_use_import_allowed: true, expected_occurrence_count: 12, expected_dictionary_count: 12, expected_included_count: 12, status: "active", package_json: { syntheticFixture: true }, activated_at_utc: "2026-09-01T00:00:00Z" });
  const sourceId = (i: number) => "entry-" + (i + 1).toString(16).padStart(24, "0");
  for (let i = 0; i < 12; i++) await insert("word_index.app_exam_use_occurrence", {
    release_id: id(20), dataset_id: datasetId, source_row: i + 1, vocab_entry_id: entryIds[i], unit_id: id(50 + Math.floor(i / 4)), position_in_unit: i % 4 + 1, dictionary_id: `word:fake-${i}`,
    display_headword: words[i], display_gloss_ko: `가짜 뜻${i}`, display_pronunciation_review_status: "candidate", audio_status: "disabled", listening_enabled: false,
    occurrence_id: `occ:a4-${i}`, occurrence_content_hash: hash("occ" + i), package_entry_content_hash: hash("occ" + i), exam_review_id: `exam-review:a4-${i}`, exam_input_hash: common, exam_use_status: "reviewed_for_preview", context_evidence_status: "source_entry_context", context_evidence: { syntheticFixture: true }, source_projection_row_sha256: hash("row" + i), source_entry_id: sourceId(i), source_entry_sha256: hash("row" + i), include_in_exam: true, audio_json: {}, package_entry_json: { syntheticFixture: true },
  });
  await insert("word_index.app_canonical_question_preview_release", {
    release_id: id(30), release_key: "a4-synthetic-questions", dataset_id: datasetId, exam_use_release_id: id(20), release_profile: "simseok_sem2_combined_v2", contract: "simseok-combined-app-preview-question-package-v2", schema_version: "2.0", policy_version: "simseok-sem2-combined-preview-v2",
    ...Object.fromEntries(["package_file_sha256", "package_content_hash", "manifest_content_hash", "definition_input_sha256", "example_input_sha256", "question_input_sha256", "occurrence_input_sha256", "item_binding_sha256", "handoff_manifest_file_sha256", "independent_review_ledger_sha256", "generator_file_sha256"].map(key => [key, common])),
    target_environment: "preview", source_shadow_only: true, preview_apply_allowed: true, canonical_approved: false, release_allowed: false, production_apply_allowed: false, expected_item_count: 12, expected_expanded_count: 12, expected_source_entry_count: 12, status: "active", activated_at_utc: "2026-09-01T00:00:00Z",
  });
  for (let i = 0; i < 12; i++) {
    const group = Math.floor(i / 4) * 4, choices = [0, 1, 2, 3].map(j => group + (i % 4 + j) % 4), questionHash = hash("question" + i);
    await insert("word_index.app_canonical_question_preview_item", {
      release_id: id(30), dataset_id: datasetId, exam_use_release_id: id(20), source_entry_id: sourceId(i), source_row: i + 1, vocab_entry_id: entryIds[i], unit_id: id(50 + Math.floor(i / 4)), question_item_id: `a4-example-${i}`, question_item_sha256: questionHash,
      target_definition_item_id: `a4-definition-${i}`, target_sense_family_id: `a4-family-${i}`, target_family_revision_hash: common, target_headword: words[i], target_part_of_speech: "noun", target_pos_signature: ["noun"], quiz_mode: mode,
      prompt_en: `Synthetic context ${i}: choose _____.`, choice_headwords: choices.map(n => words[n]), choice_source_entry_ids: choices.map(sourceId), choice_vocab_entry_ids: choices.map(n => entryIds[n]), correct_choice_index: 0,
      source_occurrence_content_hash: hash("occ" + i), source_definition_content_hash: common, source_example_content_hash: common, source_question_content_hash: questionHash, choice_pool_content_hash: common, prompt_source_hash: hash("prompt" + i), review_input_sha256: questionHash, review_audit_sha256: questionHash, review_solver_sha256: common,
      required_gates: { bounded_single_answer_heuristic: true, four_unique_choices: true, no_synonym_gloss_or_word_family_conflict: true, prompt_shape_valid: true, same_part_of_speech_signature: true }, provenance: { syntheticFixture: true, sourceShadowOnly: true, productionApplyAllowed: false },
    });
  }
  units = Array.from({ length: 3 }, (_, i) => ({ id: id(50 + i), datasetId, label: `DAY ${i + 1}`, displayName: `DAY ${i + 1}`, sortIndex: i + 1, entryCount: 4, kind: "day", number: i + 1, catalogGroup: null, unitType: null, academicYear: null, examMonth: null, agency: null, itemRange: null, catalogSortIndex: i + 1 }));
  mocks.load.mockResolvedValue({ dataset: { id: datasetId, title: "가짜 예문", displayName: "가짜 예문", status: "ready", isActive: true, isAssignable: true }, students: [{ id: id(2), displayName: "가짜 학생", status: "active" }], units });
  const allowed = new Set(["list_active_canonical_question_preview_v1", "get_bulk_vocab_series_result_v1", "get_canonical_assignment_preview_result_v1", "create_bulk_vocab_assignments_v11", "get_vocab_assignment_queue_result_v1", "create_vocab_assignment_queues_v3"]);
  mocks.client.mockResolvedValue({ rpc: async (name: string, params: Record<string, unknown>) => {
    if (!allowed.has(name)) throw new Error("Unexpected isolated RPC: " + name);
    const entries = Object.entries(params); if (entries.some(([key]) => !/^p_[a-z0-9_]+$/.test(key))) throw new Error("Invalid parameter");
    if (name === "create_bulk_vocab_assignments_v11") savedBatches = structuredClone(params.p_batches as Record<string, unknown>[]);
    const values = entries.map(([key, value]) => ["p_batches", "p_series"].includes(key) ? JSON.stringify(value) : value);
    const call = `public.${name}(${entries.map(([key], i) => `${key} => $${i + 1}`).join(",")})`;
    return { data: name.startsWith("list_") ? (await db.query(`select * from ${call}`, values)).rows : await scalar(`select ${call} value`, values), error: null };
  } });
}, 120_000);
afterAll(async () => { await db?.close(); });
beforeEach(async () => { savedBatches = []; await db.exec("begin"); });
afterEach(async () => { await db.exec("rollback"); });
function draft(assignmentMode: "per_session" | "word_count", dated = false) {
  let planner = { ...createInitialVocabPlannerState([], "", "2099-09-01"), datasetId, planNonce: id(40) };
  planner = vocabPlannerReducer(planner, { type: "assignment_mode", value: assignmentMode });
  if (assignmentMode === "word_count") planner = vocabPlannerReducer(planner, { type: "manual_question_count", value: 4 });
  if (assignmentMode === "word_count") planner = vocabPlannerReducer(planner, { type: "question_count_mode", value: "manual" });
  if (dated) {
    planner = vocabPlannerReducer(planner, { type: "schedule/update", patch: { weekdays: [1] } });
    planner = vocabPlannerReducer(planner, { type: "overflow_policy", value: "continue_weekly" });
  }
  let derived: ReturnType<typeof useVocabAssignmentDerivedPlan> | undefined;
  function Probe() { derived = useVocabAssignmentDerivedPlan({ planner, selectedUnits: units }); return null; }
  renderToStaticMarkup(createElement(Probe)); expect(derived!.localIssues).toEqual([]);
  const value = createInitialBulkSeriesAssignmentDraft({ studentIds: [id(2)], commonPlan: derived!.commonPlan });
  return { ...value, questionMode: mode, exam: { ...value.exam, directionRatio: 0 as const, questionOrderMode: "ascending" as const, timeLimitEnabled: false } };
}
async function inputFor(assignmentMode: "per_session" | "word_count", dated = false) {
  const value = draft(assignmentMode, dated), request = bulkAssignmentPreviewSchema.parse(buildBulkAssignmentPreviewRequest(value).body);
  const { preview } = await resolveBulkAssignmentPreview(request, admin);
  expect(preview.items[0]!.available, preview.items[0]!.error ?? undefined).toBe(true);
  expect(preview.items[0]!.sessions.map(s => s.questionCount)).toEqual([4, 4, 4]);
  return bulkAssignmentSchema.parse(buildBulkAssignmentRequest(value, id(60), Date.now(), preview.planSignature).body);
}
async function rejected(operation: () => Promise<unknown>, pattern: RegExp) {
  await db.exec("savepoint expected_rejection"); await expect(operation()).rejects.toThrow(pattern);
  await db.exec("rollback to expected_rejection; release expected_rejection");
}
it.each(["per_session", "word_count"] as const)("%s 예문3회 실제 저장·첫 시험 완료·둘째 문항·중복/위조 보호", async assignmentMode => {
  const input = await inputFor(assignmentMode), result = await createBulkAssignments(input, admin), ids = result.map(r => r.assignment_id!);
  expect(ids).toHaveLength(3);
  const stored = (await db.query<{ question_count: number; quiz_content_mode: string; available_from: null; available_until: null }>("select question_count,quiz_content_mode,available_from,available_until from public.assignments where id=any($1)", [ids])).rows;
  expect(stored.every(s => s.question_count === 4 && s.quiz_content_mode === mode && s.available_from === null && s.available_until === null)).toBe(true);
  const release = (assignment: string) => scalar<{ state: string }>("select private.student_assignment_release_v1($1,$2,clock_timestamp()) value", [id(2), assignment]);
  expect((await Promise.all(ids.map(release))).map(r => r.state)).toEqual(["unrestricted", "waiting_initial", "waiting_initial"]);
  await rejected(() => db.query("select public.create_quiz_attempt_from_bank($1,$2)", [id(2), ids[1]]), /not_open|not_available|locked|release/);
  const attempt = await scalar<string>("select public.create_quiz_attempt_from_bank($1,$2) value", [id(2), ids[0]]);
  const questions = (await db.query<{ id: string; correct_choice_index: number }>("select id,correct_choice_index from public.quiz_questions where attempt_id=$1 order by order_index", [attempt])).rows;
  for (let i = 0; i < questions.length; i++) {
    if (i > 0) await db.query("select public.resume_quiz_after_feedback_v2($1,$2,$3,'initial',0)", [id(2), attempt, questions[i]!.id]);
    await db.query("select public.answer_quiz_question_v4($1,$2,$3,'initial',$4,false)", [id(2), attempt, questions[i]!.id, questions[i]!.correct_choice_index]);
  }
  expect((await release(ids[1]!)).state).toBe("open"); expect((await release(ids[2]!)).state).toBe("waiting_initial");
  const next = await scalar<string>("select public.create_quiz_attempt_from_bank($1,$2) value", [id(2), ids[1]]);
  const rows = (await db.query<{ source_row: number; same_snapshot: boolean }>(`select e.source_row,(q.prompt=a.prompt and q.choices=a.choices and q.correct_choice_index=a.correct_choice_index) same_snapshot
    from public.quiz_questions q join public.assignment_questions a on a.id=q.assignment_question_id join public.vocab_entries e on e.id=a.vocab_entry_id where q.attempt_id=$1 order by q.order_index`, [next])).rows;
  expect(rows.map(r => r.source_row)).toEqual([5, 6, 7, 8]); expect(rows.every(r => r.same_snapshot)).toBe(true);
  expect(await createBulkAssignments(input, admin)).toEqual(result);
  const forged = JSON.parse(JSON.stringify(savedBatches)); forged[2].questions[0].reviewed_bank.question_item_sha256 = hash("forged");
  await rejected(() => db.query("select public.create_bulk_vocab_assignments_v11($1,$2,$3::jsonb)", [id(61), hash("request"), JSON.stringify(forged)]), /snapshot_mismatch/);
  expect(await scalar("select count(*)::int value from public.assignments")).toBe(3);
  expect(await scalar("select count(distinct vocab_entry_id)::int value from public.assignment_questions")).toBe(12);
  expect(await scalar("select count(*)::int value from private.bulk_vocab_series_requests where idempotency_key=$1", [id(61)])).toBe(0);
}, 60_000);
it.each(["per_session", "word_count"] as const)("%s 날짜있는 예문은 첫회차와 후속2회 예약으로 저장한다", async assignmentMode => {
  const input = await inputFor(assignmentMode, true), result = await createBulkAssignments(input, admin);
  expect(result.map(r => r.status)).toEqual(["assigned", "queued", "queued"]);
  expect(result.filter(r => r.assignment_id)).toHaveLength(1);
  expect(await scalar("select count(*)::int value from private.vocab_assignment_series_items")).toBe(3);
  expect(await scalar("select count(*)::int value from public.assignments where available_from is not null and available_until is not null and quiz_content_mode=$1", [mode])).toBe(1);
  expect(await createBulkAssignments(input, admin)).toEqual(result);
}, 60_000);
it("예문 버전이 미리보기 뒤 바뀌면 저장 전 충돌로 거절한다", async () => {
  const input = await inputFor("word_count");
  await db.query("update word_index.app_canonical_question_preview_item set question_item_sha256=$1 where question_item_id='a4-example-0'", [hash("changed")]);
  await expect(createBulkAssignments(input, admin)).rejects.toMatchObject({ reason: "conflict" });
  expect(await scalar("select count(*)::int value from public.assignments")).toBe(0);
});
