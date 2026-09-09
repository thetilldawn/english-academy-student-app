import type { PGlite } from "@electric-sql/pglite";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { createFinalSchemaDatabase } from "@/test-support/final-schema-database";
import { reviewedExamFixture, reviewedFixtureId as id } from "@/test-support/reviewed-exam-fixtures";
import { vocabPronunciationReleaseHeader } from "@/lib/vocab/vocab-pronunciation-release-v2-contract";
import type { AdminContext } from "@/lib/auth/admin";
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

// Only the auth/query transport is adapted. Planner, schemas, preview, command,
// persistence RPCs, final DB functions and student answers all execute for real.
describe.sequential("무날짜 계획부터 실제 저장·첫 시험·다음 공개", () => {
  let db: PGlite;
  let datasetId: string;
  let units: AssignmentUnitItem[];
  const fixture = reviewedExamFixture();
  const admin: AdminContext = { userId: id(1), displayName: "가짜 관리자" };
  const scalar = async <T>(sql: string, args: unknown[] = []) =>
    (await db.query<{ value: T }>(sql, args)).rows[0]!.value;
  const rpc = async (name: string, ...args: unknown[]) => scalar(
    `select public.${name}(${args.map((_, i) => "$" + (i + 1)).join(",")}) value`,
    args.map(value => typeof value === "string" ? value : JSON.stringify(value)),
  );
  beforeAll(async () => {
    db = await createFinalSchemaDatabase();
    await db.exec(`insert into auth.users(id) values('${id(1)}');
      insert into public.admin_profiles(user_id,display_name) values('${id(1)}','가짜 관리자');
      insert into public.students(id,display_name,created_by) values('${id(2)}','가짜 학생','${id(1)}'),('${id(3)}','다른 가짜 학생','${id(1)}');
      select set_config('request.jwt.claim.sub','${id(1)}',false);
      select set_config('request.jwt.claim.role','authenticated',false);
      select set_config('request.jwt.claims','{"role":"authenticated","ref":"wojxpruvbjzbhrpmsbuy"}',false);`);
    const voice = fixture.voice;
    const priorId = await scalar<string>("insert into public.vocab_datasets(dataset_key,title,source_label,source_sha256,row_count) values($1,'가짜 이전 자료','fake',$2,278) returning id value", [voice.dataset_key, voice.dataset_source_sha256]);
    const priorUnit = await scalar<string>("insert into public.vocab_units(dataset_id,unit_label,normalized_label,unit_kind,sort_index,entry_count) values($1,'가짜 이전 범위','fake','supplement',1,278) returning id value", [priorId]);
    await db.query("insert into public.vocab_dataset_catalog(dataset_id,display_name,catalog_group,material_kind,is_assignable) values($1,'가짜 모의고사','high_mock','exam_prep',false)", [priorId]);
    await db.query(`insert into public.vocab_entries(dataset_id,source_row,row_sha256,headword,headword_normalized,meanings,primary_meaning,unit_id,position_in_unit,entry_type)
      select $1,r.source_row,r.entry_row_sha256,r.headword,r.headword_normalized,array['가짜'],'가짜',$3,r.source_row,'word'
      from jsonb_to_recordset($2::jsonb) r(source_row int,entry_row_sha256 text,headword text,headword_normalized text)`, [priorId, JSON.stringify(voice.bindings), priorUnit]);
    await rpc("stage_school_pronunciation_release_v1", vocabPronunciationReleaseHeader(voice as never));
    await rpc("import_vocab_pronunciation_identity_batch_v3", voice.release_id, voice.identities);
    await rpc("import_vocab_pronunciation_binding_batch_v3", voice.release_id, voice.bindings);
    await rpc("verify_vocab_pronunciation_release_v3", voice.release_id);
    await rpc("activate_vocab_pronunciation_release_v3", voice.release_id);
    await db.query("insert into private.reviewed_exam_import_approvals values('wojxpruvbjzbhrpmsbuy',$1,$2,$3,278,1112,'fake-approval')", [fixture.fileHash, fixture.bundle.content_sha256, fixture.bundle.dataset.key]);
    const imported = await scalar<{ release_id: string; dataset_id: string }>("select private.import_reviewed_exam_bundle_v1($1) value", [fixture.text]);
    datasetId = imported.dataset_id;
    await db.query("select private.activate_reviewed_exam_release_v1($1,$2)", [imported.release_id, fixture.bundle.content_sha256]);
    const rows = (await db.query<{ id: string; label: string; sortIndex: number; entryCount: number }>(
      'select id,unit_label label,sort_index "sortIndex",entry_count "entryCount" from public.vocab_units where dataset_id=$1 order by sort_index', [datasetId])).rows;
    units = rows.map(row => ({ ...row, datasetId, kind: "day", number: row.sortIndex, catalogGroup: null, unitType: null, displayName: row.label, academicYear: null, examMonth: null, agency: null, itemRange: null, catalogSortIndex: row.sortIndex }));
    mocks.load.mockImplementation(async () => ({
      dataset: { id: datasetId, title: "가짜 자료", displayName: "가짜 자료", status: "ready", isActive: true, isAssignable: true, questionBankKind: "reviewed_exam_v1" },
      students: [{ id: id(2), displayName: "가짜 학생", status: "active" }], units,
    }));
    const allowed = new Set(["list_active_reviewed_exam_questions_v1", "get_bulk_vocab_series_result_v1", "get_canonical_assignment_preview_result_v1", "create_bulk_vocab_assignments_v11"]);
    mocks.client.mockResolvedValue({ rpc: async (name: string, params: Record<string, unknown>) => {
      if (!allowed.has(name)) throw new Error(`Unexpected isolated RPC: ${name}`);
      const entries = Object.entries(params);
      if (entries.some(([key]) => !/^p_[a-z0-9_]+$/.test(key))) throw new Error("Invalid parameter name");
      const values = entries.map(([key, value]) => key === "p_batches" ? JSON.stringify(value) : value);
      const call = `public.${name}(${entries.map(([key], i) => `${key} => $${i + 1}`).join(",")})`;
      if (name.startsWith("list_")) return { data: (await db.query(`select * from ${call}`, values)).rows, error: null };
      return { data: await scalar(`select ${call} value`, values), error: null };
    } });
  }, 120_000);
  afterAll(async () => { await db?.close(); });
  beforeEach(async () => { await db.exec("begin"); });
  afterEach(async () => { await db.exec("rollback"); });

  function draft(usesDates: boolean) {
    let planner = { ...createInitialVocabPlannerState([], "", "2099-09-01"), datasetId, planNonce: id(40) };
    planner = vocabPlannerReducer(planner, { type: "assignment_mode", value: "word_count" });
    planner = vocabPlannerReducer(planner, { type: "question_count_mode", value: "manual" });
    planner = vocabPlannerReducer(planner, { type: "manual_question_count", value: 4 });
    planner = vocabPlannerReducer(planner, { type: "schedule/enabled", enabled: usesDates });
    let derived: ReturnType<typeof useVocabAssignmentDerivedPlan> | undefined;
    function Probe() { derived = useVocabAssignmentDerivedPlan({ planner, selectedUnits: units.slice(0, 1) }); return null; }
    renderToStaticMarkup(createElement(Probe));
    expect(derived!.localIssues).toEqual([]);
    const result = createInitialBulkSeriesAssignmentDraft({ studentIds: [id(2)], commonPlan: derived!.commonPlan });
    return { ...result, questionMode: "canonical_definition_to_headword" as const,
      exam: { ...result.exam, directionRatio: 0 as const, passingScore: 80, retryEnabled: true, retryPassingScore: 80, questionOrderMode: "ascending" as const, timeLimitEnabled: false } };
  }
  async function release(assignment: string) {
    return scalar<{ state: string }>("select private.student_assignment_release_v1($1,$2,clock_timestamp()) value", [id(2), assignment]);
  }
  async function reject(operation: () => Promise<unknown>, pattern: RegExp) {
    await db.exec("savepoint expected_rejection");
    await expect(operation()).rejects.toThrow(pattern);
    await db.exec("rollback to expected_rejection; release expected_rejection");
  }
  it.each([false, true])("시험일 사용 %s·요일0: 12/4 실제3회 저장과 첫 시험 미달 후 다음 공개", async enabled => {
    const inputDraft = draft(enabled);
    const previewInput = bulkAssignmentPreviewSchema.parse(buildBulkAssignmentPreviewRequest(inputDraft).body);
    expect(previewInput.commonPlan).toMatchObject({ selectedDateCount: 0, distribution: "split" });
    const { preview } = await resolveBulkAssignmentPreview(previewInput, admin);
    expect(preview.items[0].sessions.map(s => s.questionCount)).toEqual([4, 4, 4]);
    const input = bulkAssignmentSchema.parse(buildBulkAssignmentRequest(inputDraft, id(50), Date.now(), preview.planSignature).body);
    const result = await createBulkAssignments(input, admin);
    expect(result).toHaveLength(3);
    const ids = result.map(r => r.assignment_id!);
    const stored = (await db.query<{ id: string; question_count: number; available_from: null; available_until: null }>("select id,question_count,available_from,available_until from public.assignments where id=any($1)", [ids])).rows;
    expect(stored.every(r => r.question_count === 4 && r.available_from === null && r.available_until === null)).toBe(true);
    const assigned = (await db.query<{ vocab_entry_id: number }>("select vocab_entry_id from public.assignment_questions where assignment_id=any($1)", [ids])).rows;
    expect(assigned).toHaveLength(12); expect(new Set(assigned.map(r => r.vocab_entry_id)).size).toBe(12);
    expect((await Promise.all(ids.map(release))).map(r => r.state)).toEqual(["unrestricted", "waiting_initial", "waiting_initial"]);
    await reject(() => db.query("select public.create_quiz_attempt_from_bank($1,$2)", [id(2), ids[1]]), /not_open|not_available|locked|release/);
    const attempt = await scalar<string>("select public.create_quiz_attempt_from_bank($1,$2) value", [id(2), ids[0]]);
    const questions = (await db.query<{ id: string; correct_choice_index: number }>("select id,correct_choice_index from public.quiz_questions where attempt_id=$1 order by order_index", [attempt])).rows;
    for (let i = 0; i < questions.length; i++) {
      const q = questions[i];
      if (i > 0) await db.query("select public.resume_quiz_after_feedback_v2($1,$2,$3,'initial',0)", [id(2), attempt, q.id]);
      await db.query("select public.answer_quiz_question_v4($1,$2,$3,'initial',$4,false)", [id(2), attempt, q.id, i < 2 ? q.correct_choice_index : (q.correct_choice_index + 1) % 4]);
    }
    const first = await scalar<{ phase: string; initial_score: number; initial_completed_at: string }>("select to_jsonb(a) value from public.quiz_attempts a where id=$1", [attempt]);
    expect(first).toMatchObject({ phase: "review", initial_score: 50 }); expect(first.initial_completed_at).toBeTruthy();
    expect((await Promise.all(ids.map(release))).map(r => r.state)).toEqual(["unrestricted", "open", "waiting_initial"]);
    const next = await scalar<string>("select public.create_quiz_attempt_from_bank($1,$2) value", [id(2), ids[1]]);
    const nextSources = (await db.query<{ assignment_id: string }>("select aq.assignment_id from public.quiz_questions q join public.assignment_questions aq on aq.id=q.assignment_question_id where q.attempt_id=$1", [next])).rows;
    expect(nextSources).toHaveLength(4); expect(nextSources.every(r => r.assignment_id === ids[1])).toBe(true);
    expect(await createBulkAssignments(input, admin)).toEqual(result);
    expect(await scalar("select count(*)::int value from public.assignments")).toBe(3);
    expect(await scalar("select count(*)::int value from public.assignment_students where student_id=$1", [id(3)])).toBe(0);
  }, 60_000);
});
