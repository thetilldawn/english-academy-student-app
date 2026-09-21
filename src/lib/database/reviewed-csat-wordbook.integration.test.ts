import { createHash } from "node:crypto";
import type { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { sha256CanonicalJson } from "@/lib/vocab/exam-use-import-contract";
import { sealReviewedMockBundle, type ReviewedMockBundle } from "@/lib/vocab/reviewed-mock-import-contract";
import { createFinalSchemaDatabase } from "@/test-support/final-schema-database";
import { buildReviewedCsatFixture, buildReviewedMockFixture, resealMockReview } from "@/test-support/reviewed-mock-wordbook-fixture";

const project = "wojxpruvbjzbhrpmsbuy";
const digest = (text: string) => createHash("sha256").update(text).digest("hex");
const adminId = "00000000-0000-4000-8000-000000099421";
const studentId = "00000000-0000-4000-8000-000000099422";
describe.sequential("reviewed CSAT registration without changing existing materials", () => {
  let db: PGlite, oldDataset: string, preserved: unknown;
  const scalar = async <T>(sql: string, args: unknown[] = []) => (await db.query<{ value: T }>(sql, args)).rows[0]!.value;
  const owner = () => db.exec("reset role");
  const service = () => db.exec("reset role; set role service_role; select set_config('request.jwt.claim.role','service_role',false)");
  const importBundle = (b: ReviewedMockBundle) => scalar<{ datasetId: string; releaseId: string; registeredScopeCount: number; idempotent?: boolean }>("select public.import_reviewed_mock_wordbook_v1($1) value", [JSON.stringify(b)]);
  const snapshot = () => scalar(`select jsonb_build_object(
    'dataset',(select to_jsonb(d) from public.vocab_datasets d where id=$1),
    'entries',(select jsonb_agg(to_jsonb(e) order by id) from public.vocab_entries e where dataset_id=$1),
    'units',(select jsonb_agg(to_jsonb(u) order by id) from public.vocab_units u where dataset_id=$1),
    'students',(select jsonb_agg(to_jsonb(s) order by id) from public.students s),
    'assignments',(select jsonb_agg(to_jsonb(a) order by id) from public.assignments a),
    'assignmentStudents',(select jsonb_agg(to_jsonb(a) order by assignment_id,student_id) from public.assignment_students a),
    'assignmentQuestions',(select jsonb_agg(to_jsonb(q) order by id) from public.assignment_questions q),
    'attempts',(select jsonb_agg(to_jsonb(a) order by id) from public.quiz_attempts a),
    'answers',(select jsonb_agg(to_jsonb(q) order by id) from public.quiz_questions q),
    'wrongQueue',(select jsonb_agg(to_jsonb(q) order by id) from public.student_vocab_review_queue q)
  ) value`, [oldDataset]);
  async function approve(b: ReviewedMockBundle, expectedLinks?: Record<string, number>) {
    await owner();
    const links = expectedLinks ?? Object.fromEntries(["dictionary", "pos", "pronunciation", "definition", "example"].map(key =>
      [key, b.resources.filter(r => r[key as "dictionary"].status === "linked").length]));
    await db.query(`insert into private.reviewed_mock_source_approvals_v1
      (approval_id,target_project_ref,dataset_key,bundle_file_sha256,content_sha256,package_version,occurrence_count,included_count,scope_count,expected_link_counts,review_evidence_sha256)
      values($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
    [b.approval_id, project, b.package.dataset_key, digest(JSON.stringify(b)), b.content_sha256, b.package.package_version,
      b.package.entries.length, b.package.entries.filter(e => e.include_in_exam).length, b.scopes.length, JSON.stringify(links),
      sha256CanonicalJson([...b.resources].sort((a, c) => a.source_row - c.source_row).map(r => r.review_records))]);
    await service();
  }
  beforeAll(async () => {
    db = await createFinalSchemaDatabase();
    await db.exec(`select set_config('request.jwt.claims','{"ref":"${project}"}',false);
      insert into auth.users(id) values('${adminId}');
      insert into public.admin_profiles(user_id,display_name) values('${adminId}','가짜 관리자');
      insert into public.students(id,display_name,created_by,school_name,grade_label) values('${studentId}','가짜 학생','${adminId}','가짜 고등학교','고3')`);
    const old = buildReviewedMockFixture();
    old.package.dataset_key = "g12-long-reading-2025-exam-scope-v1";
    sealReviewedMockBundle(old);
    await service();
    oldDataset = (await scalar<{ datasetId: string }>("select public.import_app_exam_use_package_v1($1::jsonb) value", [JSON.stringify(old.package)])).datasetId;
    await owner();
    await db.exec(`begin; select set_config('request.jwt.claim.sub','${adminId}',false)`);
    const entryId = await scalar<number>("select id value from public.vocab_entries where dataset_id=$1 order by source_row limit 1", [oldDataset]);
    const assignment = await scalar<string>(`insert into public.assignments(title,dataset_id,range_start,range_end,question_count,time_limit_seconds,passing_score,created_by,status)
      values('가짜 기존 장문 시험',$1,1,6,1,300,80,'${adminId}','active') returning id value`, [oldDataset]);
    await db.query(`insert into public.assignment_units(assignment_id,dataset_id,unit_id,position,is_primary)
      select $1,$2,id,row_number() over(order by sort_index),true from public.vocab_units where dataset_id=$2`, [assignment, oldDataset]);
    await db.query(`insert into public.assignment_questions(assignment_id,vocab_entry_id,base_order_index,direction,prompt,choices,correct_choice_index)
      values($1,$2,1,'english_to_korean','fixture1','["가짜 뜻 1","가짜 뜻 2","가짜 뜻 3","가짜 뜻 4"]',0)`, [assignment, entryId]);
    await db.query(`insert into public.assignment_students(assignment_id,student_id,assigned_by) values($1,'${studentId}','${adminId}')`, [assignment]);
    const attempt = await scalar<string>(`insert into public.quiz_attempts(student_id,assignment_id,attempt_number,deadline_at,question_count_snapshot,time_limit_seconds_snapshot,passing_score_snapshot,passing_basis_snapshot)
      values('${studentId}',$1,1,now()+interval '5 minutes',1,300,80,'initial') returning id value`, [assignment]);
    const question = await scalar<string>(`insert into public.quiz_questions(attempt_id,vocab_entry_id,order_index,direction,prompt,choices,correct_choice_index,initial_choice_index,initial_is_correct,initial_answered_at)
      values($1,$2,1,'english_to_korean','fixture1','["가짜 뜻 1","가짜 뜻 2","가짜 뜻 3","가짜 뜻 4"]',0,1,false,now()) returning id value`, [attempt, entryId]);
    await db.query(`insert into public.student_vocab_review_queue(student_id,dataset_id,vocab_entry_id,source_attempt_id,source_question_id,reason_level,queued_by)
      values('${studentId}',$1,$2,$3,$4,1,'${adminId}')`, [oldDataset, entryId, attempt, question]);
    await db.exec("commit");
    const history = await snapshot() as Record<string, unknown[]>;
    for (const key of ["students", "assignments", "assignmentStudents", "assignmentQuestions", "attempts", "answers", "wrongQueue"]) expect(history[key]).toHaveLength(1);
    preserved = history;
  }, 60000);
  afterAll(async () => db?.close());

  it("rejects unapproved CSAT and normal import bypasses including padded keys", async () => {
    const b = buildReviewedCsatFixture(); await service();
    await expect(importBundle(b)).rejects.toThrow("reviewed_mock_not_approved");
    for (const key of [b.package.dataset_key, ` ${b.package.dataset_key} `]) {
      await expect(db.query("select public.import_app_exam_use_package_v1($1::jsonb)", [JSON.stringify({ ...b.package, dataset_key: key })])).rejects.toThrow("reviewed_mock_import_required");
    }
    await expect(db.query("select private.import_app_exam_use_package_core_v1($1::jsonb)", [JSON.stringify(b.package)])).rejects.toThrow("permission denied");
  });
  it.each([2023, 2024, 2025] as const)("imports execution %i under the academic year and preserves all prior data", async year => {
    const b = buildReviewedCsatFixture(year); await approve(b);
    const saved = await importBundle(b); expect(saved.registeredScopeCount).toBe(25);
    expect(await importBundle(b)).toMatchObject({ datasetId: saved.datasetId, idempotent: true });
    await owner();
    expect(await scalar("select to_jsonb(c)-array['id','dataset_id','created_at','updated_at'] value from public.vocab_dataset_catalog c where dataset_id=$1", [saved.datasetId]))
      .toMatchObject({ catalog_group: "csat", academic_year: year + 1, series_title: "수능 유형별 단어" });
    expect(await scalar("select count(*)::int value from public.vocab_unit_catalog c join public.vocab_units u on u.id=c.unit_id where u.dataset_id=$1 and c.catalog_group='csat' and c.academic_year=$2 and c.exam_month=11", [saved.datasetId, year + 1])).toBe(25);
    const row = await scalar("select jsonb_build_object('meaning',primary_meaning,'definition',english_definition,'example',example_ko) value from public.vocab_entries where dataset_id=$1 and source_row=1", [saved.datasetId]);
    expect(row).toEqual({ meaning: "가짜 뜻 1", definition: "A fabricated fixture definition.", example: "가짜 예문 하나." });
    expect(await snapshot()).toEqual(preserved);
  });
  it.each(["academic", "kind", "month", "future", "duplicate", "missing"])("rejects reviewed but inconsistent %s metadata atomically", async defect => {
    const version = ["academic", "kind", "month", "future", "duplicate", "missing"].indexOf(defect) + 2;
    const b = buildReviewedCsatFixture(2025, version);
    if (defect === "academic") b.scopes[0]!.metadata.academicYear = 2025;
    if (defect === "kind") b.scopes[0]!.metadata = { ...buildReviewedMockFixture().scopes[0]!.metadata, executionYear: 2025, examMonth: 11 };
    if (defect === "month") Object.assign(b.scopes[0]!.metadata, { examMonth: 9 });
    if (defect === "future") b.package.dataset_key = `g12-csat-2026-v${version}`;
    if (defect === "duplicate") b.scopes[1]!.metadata.questionNumbers = [18];
    if (defect === "missing") {
      const unit = b.scopes.pop()!.unit_label;
      b.package.entries = b.package.entries.filter(e => e.unit !== unit);
      b.resources = b.resources.filter(r => b.package.entries.some(e => e.source_row === r.source_row));
    }
    resealMockReview(b); await approve(b);
    await expect(importBundle(b)).rejects.toThrow(/reviewed_(?:mock|csat)_(?:bundle_invalid|scope_mismatch|scopes_invalid)/);
    await owner();
    expect(await scalar("select count(*)::int value from public.vocab_datasets where dataset_key=$1", [b.package.dataset_key])).toBe(0);
    expect(await snapshot()).toEqual(preserved);
  });
  it("preserves fixed field counts, private functions and administrator scope reading", async () => {
    const b = buildReviewedCsatFixture(2025, 10);
    b.resources[0]!.definition = { status: "missing", value: null, evidence: [], reason: "가짜 누락" };
    resealMockReview(b); await approve(b, { dictionary: 100, pos: 100, pronunciation: 0, definition: 1, example: 1 });
    await expect(importBundle(b)).rejects.toThrow("reviewed_mock_link_count_mismatch");
    await owner();
    expect(await scalar("select has_function_privilege('anon','public.import_reviewed_mock_wordbook_v1(text)','execute') or has_function_privilege('authenticated','private.import_reviewed_mock_wordbook_v1(text)','execute') value")).toBe(false);
    await db.exec(`set role authenticated; select set_config('request.jwt.claim.sub','${adminId}',false)`);
    const catalog = await scalar<{ scopes: { metadata: { examKind: string } }[] }>("select public.list_mock_wordbook_scopes_v1() value");
    expect(catalog.scopes.filter(s => s.metadata.examKind === "csat")).toHaveLength(75);
    await expect(importBundle(b)).rejects.toThrow("permission denied");
  });
});
