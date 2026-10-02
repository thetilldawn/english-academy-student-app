import { createHash, randomUUID } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { sha256CanonicalJson } from "@/lib/vocab/exam-use-import-contract";
import { sealReviewedMockBundle, type ReviewedMockBundle } from "@/lib/vocab/reviewed-mock-import-contract";
import { createFinalSchemaDatabase } from "@/test-support/final-schema-database";
import { buildReviewedCsatFixture, buildReviewedMockFixture, resealMockReview } from "@/test-support/reviewed-mock-wordbook-fixture";
import { loadExamUsePackageArchive, saveExamUsePackageArchive } from "../../../scripts/exam-use-package-archive";

const project = "wojxpruvbjzbhrpmsbuy", migration = "20261003210000_share_reviewed_package_entries.sql";
const digest = (s: string) => createHash("sha256").update(s).digest("hex");
const id = (n: number) => `a8060000-0000-4000-8000-${String(n).padStart(12, "0")}`;
type Packet = { id: string; projectRef: string; beforeText: string };
type File = ReturnType<typeof saveExamUsePackageArchive>;
type Imported = { datasetId: string; releaseId: string; idempotent: boolean };
type Plan = { attemptId: string; phase: string; planHash: string; items: Array<{ id: string; correctChoiceIndex: number }> };
type Batch = { accepted: unknown[]; retryTargets: string[]; result: { state: string; attempt: { finalScore: number; passed: boolean } } };
type Draft = { sources: string[]; questions: string; material: string };
const mock = buildReviewedMockFixture(8501), csat = buildReviewedCsatFixture(2025, 8502);
// The imported array order is deliberately unrelated to source_row. Excluded
// entries and future fields must survive reconstruction, too.
mock.package.entries[5]!.include_in_exam = false;
mock.package.entries[5]!.exam_use_status = "excluded";
Object.assign(mock.package.entries[0]!, { future_field: { text: "가짜 추가 필드", list: [3, 1, null] } });
Object.assign(mock.package, { future_header: ["preserve", "원래 순서"] });
mock.package.entries = [3, 1, 6, 2, 5, 4].map(n => mock.package.entries.find(e => e.source_row === n)!);
resealMockReview(mock);
const inputs = [mock, csat].map(b => JSON.stringify(b));
const device = "b".repeat(64);

describe.sequential("reviewed package entries share immutable occurrences with original identity", () => {
  let db: PGlite, first: File, second: File, a: Imported, b: Imported;
  let firstResult: unknown, preRows: unknown, preOnline: Awaited<ReturnType<typeof online>>;
  let preTables: Record<string, unknown>;
  let preFunctions: unknown, preCoreReplay: unknown, running: Plan, draft: Draft;
  const request = randomUUID(), directory = fs.mkdtempSync(path.join(os.tmpdir(), "exam-package-"));
  const scalar = async <T>(sql: string, args: unknown[] = []) => (await db.query<{ value: T }>(sql, args)).rows[0]!.value;
  const owner = () => db.exec("reset role; set statement_timeout='30s'; set lock_timeout='1s'; set TimeZone='UTC'; set DateStyle='ISO, MDY'");
  const service = () => db.exec(`set role service_role; select set_config('request.jwt.claim.role','service_role',false);
    select set_config('request.jwt.claims','{"ref":"${project}","role":"service_role"}',false)`);
  const admin = () => db.exec(`set role authenticated; select set_config('request.jwt.claim.sub','${id(1)}',false);
    select set_config('request.jwt.claim.role','authenticated',false); select set_config('request.jwt.claims','{"role":"authenticated"}',false)`);
  const rows = () => scalar("select jsonb_agg(to_jsonb(r) order by release_id) value from word_index.app_exam_use_release r");
  const save = (packet: Packet) => saveExamUsePackageArchive(directory, { schemaVersion: "exam-use-package-archive-v1",
    hashFormat: "postgres-jsonb-text-sha256-v1", origin: "local-synthetic", targetProjectRef: project, packet });
  const prepare = async (release: string) => save(await scalar<Packet>("select private.prepare_exam_use_package_archive_v1($1,$2) value", [release, project]));
  const apply = (file: File, action = "compact", key = randomUUID()) => {
    const p = loadExamUsePackageArchive(file.path, file.sha256).parameters;
    return scalar<{ changed: number }>("select private.apply_exam_use_package_archive_v1($1,$2,$3,$4,$5::jsonb) value",
      [key, action, p.p_target_project_ref, p.p_archive_sha256, JSON.stringify(p.p_packet)]);
  };
  async function approveImport(bundle: ReviewedMockBundle, input = JSON.stringify(bundle)) {
    await owner();
    const entries = bundle.package.entries;
    await db.query(`insert into private.reviewed_mock_source_approvals_v1
      (approval_id,target_project_ref,dataset_key,bundle_file_sha256,content_sha256,package_version,occurrence_count,included_count,scope_count,expected_link_counts,review_evidence_sha256)
      values($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`, [bundle.approval_id, project, bundle.package.dataset_key, digest(input), bundle.content_sha256,
      bundle.package.package_version, entries.length, entries.filter(e => e.include_in_exam).length, bundle.scopes.length,
      JSON.stringify({ dictionary: entries.length, pos: entries.length, pronunciation: 0, definition: 1, example: 1 }),
      sha256CanonicalJson([...bundle.resources].sort((x, y) => x.source_row - y.source_row).map(r => r.review_records))]);
    await service();
    return scalar<Imported>("select public.import_reviewed_mock_wordbook_v1($1) value", [input]);
  }
  async function tableEvidence(all = false, originalOnly = false) {
    await owner();
    const tables = (await db.query<{ name: string }>(`select quote_ident(n.nspname)||'.'||quote_ident(c.relname) name from pg_class c
      join pg_namespace n on n.oid=c.relnamespace where c.relkind='r' and n.nspname in ('public','private','word_index')
      ${all ? "" : "and c.relname not in ('app_exam_use_release','exam_use_package_archives','exam_use_package_archive_receipts','exam_use_package_write_permits')"}
      order by 1`)).rows;
    const result: Record<string, unknown> = {};
    for (const { name } of tables) {
      const entry = await scalar<{ count: number; hash: string }>(`select jsonb_build_object('count',count(*),'hash',md5(coalesce(string_agg(h,'' order by h),''))) value
        from (select md5(to_jsonb(t)::text) h from ${name} t) r`);
      if (originalOnly && preTables && !Object.hasOwn(preTables, name)) expect(entry.count).toBe(0);
      else result[name] = entry;
    }
    return result;
  }
  async function functionMetadata() {
    return scalar(`select jsonb_agg(jsonb_build_object('oid',p.oid,'name',p.proname,'owner',p.proowner,'security',p.prosecdef,
      'settings',p.proconfig,'acl',p.proacl) order by p.proname) value from pg_proc p join pg_namespace n on n.oid=p.pronamespace
      where n.nspname='private' and p.proname in ('import_app_exam_use_package_core_v1','current_wrong_review_material_fingerprint_v1','guard_reviewed_mock_source_v1','mock_wordbook_source_version')`);
  }
  async function fingerprint(d: Draft) {
    await admin();
    return scalar<string>("select public.get_current_wrong_review_material_fingerprint_v1($1,$2::jsonb,$3::uuid[]) value",
      [a.datasetId, d.questions, d.sources]);
  }
  async function online() {
    await service();
    const replay = [];
    for (const input of inputs) replay.push(await scalar("select public.import_reviewed_mock_wordbook_v1($1) value", [input]));
    await owner();
    const scopes = await scalar<Array<{ stored: string; current: string }>>(`select jsonb_agg(jsonb_build_object('stored',source_version,
      'current',private.mock_wordbook_source_version(source_release_id,source_unit_id,metadata,review_evidence_sha256)) order by id) value from word_index.mock_wordbook_scope`);
    return { replay, scopes, fingerprint: await fingerprint(draft) };
  }
  async function newExam(n: number, student: string, retry: boolean) {
    await owner();
    const units = await scalar<string[]>("select array_agg(id order by sort_index) value from public.vocab_units where dataset_id=$1", [a.datasetId]);
    const choices = await scalar<number[]>("select array_agg(id order by source_row) value from public.vocab_entries where dataset_id=$1 and source_row<=4", [a.datasetId]);
    const questions = choices.map((entry, i) => ({ vocab_entry_id: entry, base_order_index: i + 1,
      direction: "english_to_korean", choice_vocab_entry_ids: choices }));
    await admin();
    const assignment = await scalar<string>(`select public.create_assignment_with_delivery_v7($1,$2::uuid,$3::uuid[],4,100::smallint,
      300,80::smallint,$4::boolean,case when $4 then 80::smallint else null end,'fixed',null,$5::uuid[],'none',null,$6::jsonb) value`,
      [`가짜 패키지 시험 ${n}`, a.datasetId, units, retry, [student], JSON.stringify(questions)]);
    await service();
    const p = await scalar<{ preparationId: string; planHash: string }>("select public.prepare_local_quiz_v1($1,$2,$3,$4::jsonb) value",
      [student, assignment, device, null]);
    return scalar<Plan>("select public.begin_local_quiz_v1($1,$2,$3,$4) value", [student, p.preparationId, device, p.planHash]);
  }
  async function submit(student: string, p: Plan, correct: (index: number) => boolean, key: string) {
    await service();
    const answers = p.items.map((q, i) => ({ id: q.id, order: i + 1, kind: "answer",
      choice: correct(i) ? q.correctChoiceIndex : (q.correctChoiceIndex + 1) % 4, openedMs: i * 100, elapsedMs: i * 100 }));
    return scalar<Batch>("select public.submit_local_quiz_phase_v1($1,$2,$3,$4,$5,$6,$7::jsonb,$8::jsonb) value",
      [student, p.attemptId, p.phase, device, p.planHash, key, JSON.stringify(answers), JSON.stringify({ elapsedMs: (answers.length - 1) * 100, reason: "answered" })]);
  }
  async function createDraftAssignment() {
    await admin();
    const args: Record<string, unknown> = { p_student_id: id(3), p_dataset_id: a.datasetId, p_review_levels: [1],
      p_source_question_ids: draft.sources.slice(0, 2), p_idempotency_key: id(880), p_request_sha256: "c".repeat(64),
      p_title: "가짜 이전 전 준비", p_english_to_korean_ratio: 100, p_time_limit_seconds: 300, p_passing_score: 80,
      p_retry_enabled: true, p_retry_passing_score: 80, p_question_order_mode: "ascending", p_available_from: null,
      p_available_until: null, p_timing_mode: "total", p_question_time_limit_seconds: null, p_questions: draft.questions,
      p_expected_source_question_ids: draft.sources, p_excluded_source_question_ids: draft.sources.slice(2),
      p_selection_sha256: "c".repeat(64), p_material_sha256: draft.material };
    return scalar<string>(`select public.create_current_wrong_review_assignment_v3(${Object.keys(args).map((k, i) => k + "=>$" + (i + 1)).join(",")}) value`, Object.values(args));
  }
  beforeAll(async () => {
    db = await createFinalSchemaDatabase({ beforeMigration: async (old, name) => {
      if (name !== migration) return;
      db = old; a = await approveImport(mock, inputs[0]!); b = await approveImport(csat, inputs[1]!);
      await owner();
      await db.exec(`grant usage on schema auth,extensions to service_role; alter role service_role bypassrls;
        insert into auth.users(id) values('${id(1)}');
        insert into public.admin_profiles(user_id,display_name) values('${id(1)}','가짜 패키지 관리자');
        insert into public.students(id,display_name,created_by,school_name,grade_label) values('${id(2)}','가짜 진행 학생','${id(1)}','가짜 고등학교','고3'),('${id(3)}','가짜 오답 학생','${id(1)}','가짜 고등학교','고3');`);
      running = await newExam(10, id(2), true);
      const wrong = await newExam(11, id(3), false);
      expect((await submit(id(3), wrong, () => false, id(810))).accepted).toHaveLength(4);
      await admin();
      const candidates = (await db.query<{ source_question_id: string; vocab_entry_id: number }>(
        "select source_question_id,vocab_entry_id from public.list_student_direct_review_candidates_v1($1,$2,array[1]::smallint[],400)", [id(3), a.datasetId])).rows;
      expect(candidates).toHaveLength(4);
      await owner();
      const choices = await scalar<number[]>("select array_agg(id order by source_row) value from public.vocab_entries where dataset_id=$1 and source_row<=4", [a.datasetId]);
      draft = { sources: candidates.map(c => c.source_question_id), questions: JSON.stringify(candidates.slice(0, 2).map((c, i) => ({
        vocab_entry_id: c.vocab_entry_id, base_order_index: i + 1, direction: "english_to_korean", choice_vocab_entry_ids: choices }))), material: "" };
      draft.material = await fingerprint(draft);
      preOnline = await online(); await owner();
      preCoreReplay = await scalar("select private.import_app_exam_use_package_core_v1($1::jsonb) value", [JSON.stringify(mock.package)]);
      preRows = await rows(); preTables = await tableEvidence(); preFunctions = await functionMetadata();
    } });
    await owner();
  }, 120_000);
  afterAll(async () => db?.close());

  it("preserves real old imports, started exams, all existing tables and current function contracts", async () => {
    expect(await rows()).toEqual(preRows);
    expect(await tableEvidence(false, true)).toEqual(preTables);
    expect(await online()).toEqual(preOnline);
    await owner(); expect(await functionMetadata()).toEqual(preFunctions);
    expect(preOnline.scopes).toHaveLength(27);
    expect(preOnline.scopes.every(s => !!s.stored && s.stored === s.current)).toBe(true);
    expect(preOnline.replay).toEqual([{ ...a, idempotent: true }, { ...b, idempotent: true }]);
    expect(await scalar("select status::text value from public.quiz_attempts where id=$1", [running.attemptId])).toBe("in_progress");
  });
  it("reissues a lost prepare reply with the same exact packet even after retirement status changes", async () => {
    first = await prepare(a.releaseId); second = await prepare(b.releaseId);
    expect(await scalar("select private.prepare_exam_use_package_archive_v1($1,$2) value", [a.releaseId, project])).toEqual(first.parameters.p_packet);
    await db.exec("begin");
    try {
      await db.query("update word_index.app_exam_use_release set status='retired',retired_at_utc=clock_timestamp() where release_id=$1", [a.releaseId]);
      expect(await scalar("select private.prepare_exam_use_package_archive_v1($1,$2) value", [a.releaseId, project])).toEqual(first.parameters.p_packet);
      expect(await scalar("select status value from word_index.app_exam_use_release where release_id=$1", [a.releaseId])).toBe("retired");
    } finally { await db.exec("rollback"); }
    expect(await rows()).toEqual(preRows);
    expect(loadExamUsePackageArchive(first.path, first.sha256).parameters).toEqual(first.parameters);
  });
  it("reconstructs the original ordered arrays including excluded entries and unknown fields", async () => {
    await db.exec("set TimeZone='Asia/Seoul'; set DateStyle='SQL, DMY'");
    firstResult = await apply(first, "compact", request);
    expect(firstResult).toMatchObject({ changed: 1 });
    expect(await apply(second)).toMatchObject({ changed: 1 });
    await owner();
    expect(await scalar("select private.resolve_exam_use_package_json_v1($1) value", [a.releaseId])).toEqual(mock.package);
    expect(await scalar("select private.resolve_exam_use_package_json_v1($1) value", [b.releaseId])).toEqual(csat.package);
    expect(await scalar("select source_rows value from private.exam_use_package_archives where release_id=$1", [a.releaseId])).toEqual([3, 1, 6, 2, 5, 4]);
    expect(await scalar("select count(*)::int value from word_index.app_exam_use_occurrence where release_id=$1 and not include_in_exam and vocab_entry_id is null", [a.releaseId])).toBe(1);
    expect(await scalar("select package_json ? 'entries' value from word_index.app_exam_use_release where release_id=$1", [a.releaseId])).toBe(false);
    expect(await tableEvidence(false, true)).toEqual(preTables);
    expect(await online()).toEqual(preOnline);
    await owner();
    expect(await apply(first, "compact", request)).toEqual(firstResult);
    expect(await scalar("select private.import_app_exam_use_package_core_v1($1::jsonb) value", [JSON.stringify(mock.package)])).toEqual(preCoreReplay);
  });
  it("preserves the exact legacy wrong-review fingerprint and saves a draft prepared before compaction", async () => {
    expect(await fingerprint(draft)).toBe(draft.material);
    const saved = await createDraftAssignment();
    expect(saved).toMatch(/^[a-f0-9-]{36}$/);
    await owner(); const after = await tableEvidence();
    expect(await createDraftAssignment()).toBe(saved);
    expect(await tableEvidence()).toEqual(after);
    await owner();
    const changed = structuredClone(mock.package);
    changed.entries[0]!.display_gloss_ko = "같은 판 다른 항목 본문";
    await expect(scalar("select private.import_app_exam_use_package_core_v1($1::jsonb) value", [JSON.stringify(changed)])).rejects.toThrow("identity_conflict");
  });
  it("accepts a pre-migration running exam then retries and replays both submissions", async () => {
    const initial = await submit(id(2), running, i => i < 2, id(820));
    expect(initial.retryTargets).toHaveLength(2);
    await service();
    const retry = await scalar<Plan>("select public.begin_local_quiz_retry_v1($1,$2,$3) value", [id(2), running.attemptId, device]);
    const finished = await submit(id(2), retry, () => true, id(821));
    expect(finished.result.attempt).toMatchObject({ finalScore: 100, passed: true });
    await owner(); const after = await tableEvidence();
    expect(await submit(id(2), running, i => i < 2, id(820))).toEqual(initial);
    expect(await submit(id(2), retry, () => true, id(821))).toEqual(finished);
    expect(await tableEvidence()).toEqual(after);
    expect(await scalar("select count(*)::int value from private.vocabulary_answer_receipts where attempt_id=$1", [running.attemptId])).toBe(6);
  });
  it("rejects forged files, wrong projects, stale requests and unsafe execution without writes", async () => {
    await owner(); const before = await tableEvidence(true), p = first.parameters;
    const call = (packet: unknown, projectRef = project, key = randomUUID(), action = "compact") =>
      scalar("select private.apply_exam_use_package_archive_v1($1,$2,$3,$4,$5::jsonb) value", [key, action, projectRef, first.sha256, JSON.stringify(packet)]);
    await expect(call({ ...p.p_packet, beforeText: p.p_packet.beforeText.replace("가짜", "변조") })).rejects.toThrow("archive_changed");
    await expect(call(p.p_packet, "xdxhswjgksukjmpbzqgz")).rejects.toThrow("project_mismatch");
    await expect(call(p.p_packet, project, request, "restore")).rejects.toThrow("request_reused");
    await expect(call({ ...p.p_packet, id: randomUUID() })).rejects.toThrow("reviewed_source_required");
    await expect(call([p.p_packet, p.p_packet])).rejects.toThrow("packet_invalid");
    await expect(call({ ...p.p_packet, beforeText: "한".repeat(5_592_406) })).rejects.toThrow("packet_invalid");
    await expect(prepare(a.releaseId)).rejects.toThrow("archive_file_required");
    await db.exec("set statement_timeout=0"); await expect(apply(first)).rejects.toThrow("transaction_limits"); await owner();
    await db.exec("begin isolation level repeatable read");
    try { await expect(apply(first)).rejects.toThrow("transaction_limits"); } finally { await db.exec("rollback"); }
    expect(await tableEvidence(true)).toEqual(before);
  });
  it("keeps source guards active and detects damaged reference order with no empty fallback", async () => {
    await owner();
    await db.exec("select set_config('app.allow_package_archive','true',false)");
    await expect(db.query("update word_index.app_exam_use_release set package_json='{}' where release_id=$1", [a.releaseId])).rejects.toThrow("immutable");
    await expect(db.query("update word_index.app_exam_use_release set title='changed' where release_id=$1", [a.releaseId])).rejects.toThrow("immutable");
    await expect(db.query("delete from word_index.app_exam_use_release where release_id=$1", [a.releaseId])).rejects.toThrow("immutable");
    await expect(db.query("update word_index.app_exam_use_occurrence set package_entry_json='{}' where release_id=$1", [a.releaseId])).rejects.toThrow("immutable");
    await expect(db.query("delete from word_index.app_exam_use_occurrence where release_id=$1 and not include_in_exam", [a.releaseId])).rejects.toThrow("immutable");
    await db.exec("begin");
    try {
      await db.query("update private.exam_use_package_archives set source_rows=array[1,2,3,4,5,6] where release_id=$1", [a.releaseId]);
      await expect(scalar("select private.resolve_exam_use_package_json_v1($1) value", [a.releaseId])).rejects.toThrow("reference_changed");
    } finally { await db.exec("rollback"); }
    expect(await scalar("select count(*)::int value from private.exam_use_package_write_permits")).toBe(0);
  });
  it("rolls a successful restore back with its manifests, receipts and permits", async () => {
    await owner(); const before = await tableEvidence(true);
    await db.exec("begin");
    try { expect(await apply(first, "restore")).toMatchObject({ changed: 1 }); } finally { await db.exec("rollback"); }
    expect(await tableEvidence(true)).toEqual(before);
    await db.exec("begin");
    try {
      // A precise owner-only fault injection leaves every guard enabled.
      await db.query(`insert into private.exam_use_package_write_permits
        select pg_backend_pid(),txid_current(),r.release_id,private.reviewed_bundle_row_sha256_v1(to_jsonb(r)),
          private.reviewed_bundle_row_sha256_v1(jsonb_set(to_jsonb(r),'{package_json}','{}'))
        from word_index.app_exam_use_release r where release_id=$1`, [a.releaseId]);
      await db.query("update word_index.app_exam_use_release set package_json='{}' where release_id=$1", [a.releaseId]);
      await expect(apply(first, "restore")).rejects.toThrow("row_changed");
    } finally { await db.exec("rollback"); }
    expect(await tableEvidence(true)).toEqual(before);
  });
  it("restores one real file while preserving new answers, the other package and all other tables", async () => {
    await owner(); const before = await tableEvidence();
    const other = await scalar("select to_jsonb(r) value from word_index.app_exam_use_release r where release_id=$1", [b.releaseId]);
    expect(await apply(first, "restore")).toMatchObject({ changed: 1 });
    expect(await tableEvidence()).toEqual(before);
    expect(await scalar("select to_jsonb(r) value from word_index.app_exam_use_release r where release_id=$1", [b.releaseId])).toEqual(other);
    expect(await scalar("select to_jsonb(r)::text value from word_index.app_exam_use_release r where release_id=$1", [a.releaseId])).toBe(first.parameters.p_packet.beforeText);
    expect(await apply(first, "compact", request)).toEqual(firstResult);
    expect(await scalar("select state value from private.exam_use_package_archives where release_id=$1", [a.releaseId])).toBe("restored");
    expect(await scalar("select private.prepare_exam_use_package_archive_v1($1,$2) value", [a.releaseId, project])).toEqual(first.parameters.p_packet);
  });
  it("preserves a newer retirement status during body restore and rejects app operator privileges", async () => {
    await owner();
    await db.query("update word_index.app_exam_use_release set status='retired',retired_at_utc=clock_timestamp() where release_id=$1", [b.releaseId]);
    const state = await scalar("select jsonb_build_object('status',status,'time',retired_at_utc) value from word_index.app_exam_use_release where release_id=$1", [b.releaseId]);
    expect(await scalar("select private.resolve_exam_use_package_json_v1($1) value", [b.releaseId])).toEqual(csat.package);
    expect(await apply(second, "restore")).toMatchObject({ changed: 1 });
    expect(await scalar("select jsonb_build_object('status',status,'time',retired_at_utc) value from word_index.app_exam_use_release where release_id=$1", [b.releaseId])).toEqual(state);
    expect(await scalar("select private.prepare_exam_use_package_archive_v1($1,$2) value", [b.releaseId, project])).toEqual(second.parameters.p_packet);
    expect(await scalar(`select count(*)::int value from pg_proc p join pg_namespace n on n.oid=p.pronamespace
      cross join unnest(array['anon','authenticated','service_role']) role where n.nspname='private'
      and p.proname in ('exam_use_package_reference_v1','reassemble_exam_use_entries_v1','resolve_exam_use_package_json_v1','lock_exam_use_package_v1',
      'list_exam_use_package_candidates_v1','prepare_exam_use_package_archive_v1','guard_exam_use_package_write_v1','apply_exam_use_package_archive_v1')
      and has_function_privilege(role,p.oid,'execute')`)).toBe(0);
    await service(); await expect(prepare(a.releaseId)).rejects.toThrow("permission denied");
    await expect(db.query("select * from private.exam_use_package_archives")).rejects.toThrow("permission denied"); await owner();
  });
  it("does not compact unreviewed packages and discovers a newly imported reviewed release", async () => {
    const extra = buildReviewedMockFixture(8503), imported = await approveImport(extra);
    await owner();
    const candidates = await scalar<Array<{ releaseId: string }>>("select private.list_exam_use_package_candidates_v1($1) value", [project]);
    expect(candidates.some(c => c.releaseId === imported.releaseId)).toBe(true);
    const unreviewed = structuredClone(buildReviewedMockFixture(8504));
    unreviewed.package.dataset_key = "fake-unreviewed-package-8504"; sealReviewedMockBundle(unreviewed);
    const legacy = await scalar<Imported>("select private.import_app_exam_use_package_core_v1($1::jsonb) value", [JSON.stringify(unreviewed.package)]);
    await expect(prepare(legacy.releaseId)).rejects.toThrow("reviewed_source_required");
    expect((await scalar<Array<{ releaseId: string }>>("select private.list_exam_use_package_candidates_v1($1) value", [project])).some(c => c.releaseId === legacy.releaseId)).toBe(false);
  });
  it("keeps raw numeric lexemes and Unicode, verifies files and rejects repository paths", () => {
    const release = randomUUID(), beforeText = `{"release_id":"${release}","number":9007199254740993,"text":"가짜\\n원문"}`;
    const packet = { id: release, projectRef: project, beforeText }, file = save(packet);
    expect(loadExamUsePackageArchive(file.path, file.sha256).parameters.p_packet.beforeText).toBe(beforeText);
    fs.appendFileSync(file.path, " "); expect(() => loadExamUsePackageArchive(file.path, file.sha256)).toThrow("내용이 달라졌습니다");
    const envelope = { schemaVersion: "exam-use-package-archive-v1" as const, hashFormat: "postgres-jsonb-text-sha256-v1" as const,
      origin: "local-synthetic" as const, targetProjectRef: project, packet };
    expect(() => saveExamUsePackageArchive(process.cwd(), envelope)).toThrow("모든 Git 저장소 밖");
    expect(() => saveExamUsePackageArchive(directory, { ...envelope, targetProjectRef: "xdxhswjgksukjmpbzqgz" })).toThrow("대상 환경");
    expect(() => saveExamUsePackageArchive(directory, { ...envelope, packet: { ...packet, beforeText: "한".repeat(5_592_406) } })).toThrow("보관 크기");
  });
});
