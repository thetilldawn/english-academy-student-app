import { createHash, randomUUID } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { sha256CanonicalJson } from "@/lib/vocab/exam-use-import-contract";
import type { ReviewedMockBundle } from "@/lib/vocab/reviewed-mock-import-contract";
import { createFinalSchemaDatabase } from "@/test-support/final-schema-database";
import { buildReviewedCsatFixture, buildReviewedMockFixture } from "@/test-support/reviewed-mock-wordbook-fixture";
import { loadReviewedBundleArchive, saveReviewedBundleArchive } from "../../../scripts/reviewed-bundle-archive";

const project = "wojxpruvbjzbhrpmsbuy";
const migration = "20261003200000_archive_reviewed_source_bundles.sql";
const digest = (text: string) => createHash("sha256").update(text).digest("hex");
type Packet = { id: string; beforeText: string };
type File = ReturnType<typeof saveReviewedBundleArchive>;
type Imported = { datasetId: string; releaseId: string; [key: string]: unknown };
describe.sequential("reviewed source bundle: archive, replay and selective restore", () => {
  let db: PGlite, originalRows: unknown, savedMock: Imported, savedCsat: Imported;
  let first: File, second: File, firstResult: unknown;
  const requestId = randomUUID(), directory = fs.mkdtempSync(path.join(os.tmpdir(), "reviewed-bundle-"));
  const mock = buildReviewedMockFixture(8401), csat = buildReviewedCsatFixture(2025, 8402);
  const inputs = [mock, csat].map(b => JSON.stringify(b));
  const scalar = async <T>(sql: string, args: unknown[] = []) => (await db.query<{ value: T }>(sql, args)).rows[0]!.value;
  const owner = () => db.exec("reset role; set statement_timeout='30s'; set lock_timeout='1s'; set TimeZone='UTC'; set DateStyle='ISO, MDY'");
  const service = () => db.exec(`set role service_role; select set_config('request.jwt.claim.role','service_role',false);
    select set_config('request.jwt.claims','{"ref":"${project}","role":"service_role"}',false)`);
  const releaseRows = () => scalar("select jsonb_agg(to_jsonb(r) order by release_id) value from private.reviewed_mock_source_releases_v1 r");
  const save = (packet: Packet) => saveReviewedBundleArchive(directory, { schemaVersion: "reviewed-bundle-archive-v1",
    hashFormat: "postgres-jsonb-text-sha256-v1", origin: "local-synthetic", targetProjectRef: project, packet });
  const prepare = async (id: string) => save(await scalar<Packet>("select private.prepare_reviewed_bundle_archive_v1($1,$2) value", [id, project]));
  const apply = (file: File, action = "compact", key = randomUUID()) => {
    const p = loadReviewedBundleArchive(file.path, file.sha256).parameters;
    return scalar<{ changed: number }>("select private.apply_reviewed_bundle_archive_v1($1,$2,$3,$4,$5::jsonb) value",
      [key, action, p.p_target_project_ref, p.p_archive_sha256, JSON.stringify(p.p_packet)]);
  };
  async function approveImport(bundle: ReviewedMockBundle, input: string) {
    await owner();
    const rows = bundle.package.entries;
    await db.query(`insert into private.reviewed_mock_source_approvals_v1
      (approval_id,target_project_ref,dataset_key,bundle_file_sha256,content_sha256,package_version,occurrence_count,included_count,scope_count,expected_link_counts,review_evidence_sha256)
      values($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`, [bundle.approval_id, project, bundle.package.dataset_key, digest(input), bundle.content_sha256,
      bundle.package.package_version, rows.length, rows.filter(r => r.include_in_exam).length, bundle.scopes.length,
      JSON.stringify({ dictionary: rows.length, pos: rows.length, pronunciation: 0, definition: 1, example: 1 }),
      sha256CanonicalJson([...bundle.resources].sort((a, b) => a.source_row - b.source_row).map(r => r.review_records))]);
    await service();
    return scalar<Imported>("select public.import_reviewed_mock_wordbook_v1($1) value", [input]);
  }
  async function online() {
    await owner();
    const entryIds = await scalar<number[]>("select array_agg(id) value from public.vocab_entries");
    await service();
    const resources = (await db.query("select * from public.list_reviewed_mock_source_resources_v1($1::bigint[]) order by vocab_entry_id", [entryIds])).rows;
    const replays = [];
    for (const input of inputs) replays.push(await scalar("select public.import_reviewed_mock_wordbook_v1($1) value", [input]));
    await owner();
    const sources = await scalar(`select jsonb_agg(jsonb_build_object('id',s.id,'stored',s.source_version,
      'current',private.mock_wordbook_source_version(s.source_release_id,s.source_unit_id,s.metadata,s.review_evidence_sha256)) order by s.id) value
      from word_index.mock_wordbook_scope s`);
    return { resources, replays, sources };
  }
  async function preservedTables() {
    await owner();
    const tables = (await db.query<{ name: string }>(`select quote_ident(n.nspname)||'.'||quote_ident(c.relname) name
      from pg_class c join pg_namespace n on n.oid=c.relnamespace where c.relkind='r' and n.nspname in ('public','private','word_index')
      and c.relname not in ('reviewed_mock_source_releases_v1','reviewed_bundle_archives','reviewed_bundle_archive_receipts','reviewed_bundle_write_permits')
      order by 1`)).rows;
    const evidence: Record<string, unknown> = {};
    for (const { name } of tables) evidence[name] = await scalar(`select jsonb_build_object('rows',count(*),'hash',md5(coalesce(string_agg(h,'' order by h),''))) value
      from (select md5(to_jsonb(t)::text) h from ${name} t) d`);
    return evidence;
  }
  let originalOnline: Awaited<ReturnType<typeof online>>, originalTables: Awaited<ReturnType<typeof preservedTables>>;
  beforeAll(async () => {
    db = await createFinalSchemaDatabase({ beforeMigration: async (oldDb, filename) => {
      if (filename !== migration) return;
      db = oldDb;
      savedMock = await approveImport(mock, inputs[0]!); savedCsat = await approveImport(csat, inputs[1]!);
      await owner(); originalRows = await releaseRows();
      originalOnline = await online(); originalTables = await preservedTables();
    } });
    await owner();
  }, 120_000);
  afterAll(async () => db?.close());

  it("preserves real pre-migration mock and CSAT imports and all existing tables", async () => {
    expect(await releaseRows()).toEqual(originalRows);
    expect(await online()).toEqual(originalOnline);
    expect(await preservedTables()).toEqual(originalTables);
    expect(originalOnline.resources).toHaveLength(106);
    expect(originalOnline.replays).toEqual([{ ...savedMock, idempotent: true }, { ...savedCsat, idempotent: true }]);
  });
  it("prepares a byte-exact DB-row file without altering the imported row", async () => {
    first = await prepare(savedMock.releaseId); second = await prepare(savedCsat.releaseId);
    expect(await releaseRows()).toEqual(originalRows);
    expect(loadReviewedBundleArchive(first.path, first.sha256).parameters).toEqual(first.parameters);
    expect(first.sha256).not.toBe(digest(inputs[0]!)); // DB-row archive != approved raw import.
    expect(await scalar("select original_bytes>0 value from private.reviewed_bundle_archives where release_id=$1", [savedMock.releaseId])).toBe(true);
    expect(await apply(first, "restore")).toMatchObject({ changed: 0 });
    expect(await releaseRows()).toEqual(originalRows);
  });
  it("compacts one column only across session timezones with stable online readers and replay", async () => {
    await db.exec("set TimeZone='Asia/Seoul'; set DateStyle='SQL, DMY'");
    firstResult = await apply(first, "compact", requestId);
    expect(firstResult).toMatchObject({ changed: 1, releaseId: savedMock.releaseId });
    await db.exec("set TimeZone='America/New_York'");
    expect(await apply(first, "compact", requestId)).toEqual(firstResult);
    expect(await apply(second)).toMatchObject({ changed: 1 });
    expect(await online()).toEqual(originalOnline);
    expect(await preservedTables()).toEqual(originalTables);
    const now = await scalar<Array<Record<string, unknown>>>("select jsonb_agg(to_jsonb(r)-'bundle' order by release_id) value from private.reviewed_mock_source_releases_v1 r");
    expect(now).toEqual((originalRows as Array<Record<string, unknown>>).map(row => Object.fromEntries(Object.entries(row).filter(([key]) => key !== "bundle"))));
    expect(await scalar("select bool_and(octet_length(bundle::text)<600) value from private.reviewed_mock_source_releases_v1")).toBe(true);
  });
  it("rejects changed archives, wrong project, reused request, unknown release and unsafe transaction settings", async () => {
    const p = first.parameters;
    const call = (packet: unknown, projectRef = project, key = randomUUID(), action = "compact") => scalar(
      "select private.apply_reviewed_bundle_archive_v1($1,$2,$3,$4,$5::jsonb) value", [key, action, projectRef, first.sha256, JSON.stringify(packet)]);
    await expect(call({ ...p.p_packet, beforeText: p.p_packet.beforeText.replace('가짜', '변조') })).rejects.toThrow("archive_changed");
    await expect(call(p.p_packet, "xdxhswjgksukjmpbzqgz")).rejects.toThrow("project_mismatch");
    await expect(call(p.p_packet, project, requestId, "restore")).rejects.toThrow("request_reused");
    await expect(call({ ...p.p_packet, id: randomUUID() })).rejects.toThrow("missing");
    await expect(call([p.p_packet, p.p_packet])).rejects.toThrow("packet_invalid");
    await expect(call({ ...p.p_packet, other: true })).rejects.toThrow("packet_invalid");
    await expect(call({ ...p.p_packet, beforeText: "가".repeat(5_592_406) })).rejects.toThrow("packet_invalid");
    await expect(prepare(savedMock.releaseId)).rejects.toThrow("archive_file_required");
    await db.exec("set statement_timeout=0"); await expect(apply(first)).rejects.toThrow("transaction_limits"); await owner();
    await db.exec("begin isolation level repeatable read");
    try { await expect(apply(first)).rejects.toThrow("transaction_limits"); } finally { await db.exec("rollback"); }
  });
  it("preserves all immutable guards and does not accept a caller session flag", async () => {
    await owner(); await db.exec("select set_config('app.allow_bundle_archive','true',false)");
    await expect(db.query("update private.reviewed_mock_source_releases_v1 set bundle='{}' where release_id=$1", [savedMock.releaseId])).rejects.toThrow("immutable");
    await expect(db.query("delete from private.reviewed_mock_source_releases_v1 where release_id=$1", [savedMock.releaseId])).rejects.toThrow("immutable");
    await expect(db.query("update private.reviewed_mock_source_releases_v1 set result='{}' where release_id=$1", [savedMock.releaseId])).rejects.toThrow("immutable");
    await expect(db.query("update private.reviewed_mock_source_resources_v1 set payload='{}' where release_id=$1", [savedMock.releaseId])).rejects.toThrow("immutable");
    await expect(db.query("update private.reviewed_mock_source_approvals_v1 set bundle_file_sha256=repeat('b',64) where approval_id=$1", [mock.approval_id])).rejects.toThrow("immutable");
    await expect(db.query("update public.vocab_entries set primary_meaning='changed' where dataset_id=$1", [savedMock.datasetId])).rejects.toThrow("immutable");
    expect(await scalar("select count(*)::int value from private.reviewed_bundle_write_permits")).toBe(0);
  });
  it("rolls an interrupted restore back atomically and detects a changed current row", async () => {
    await db.exec("begin");
    await apply(first, "restore");
    await db.exec("rollback");
    expect(await apply(first, "compact", requestId)).toEqual(firstResult);
    await db.exec("begin");
    try {
      // Owner-only corruption of the small manifest; no bypass of source guard.
      await db.query("update private.reviewed_bundle_archives set compacted_sha256=repeat('0',64) where release_id=$1", [savedMock.releaseId]);
      await expect(apply(first, "restore")).rejects.toThrow("reference_changed");
    } finally { await db.exec("rollback"); }
  });
  it("keeps new accepted student answers when only one of two bundles is restored", async () => {
    const id = (n: number) => `a8050000-0000-4000-8000-${String(n).padStart(12, "0")}`;
    await owner();
    await db.exec(`grant usage on schema auth,extensions to service_role; alter role service_role bypassrls;
      insert into auth.users(id) values('${id(1)}');
      insert into public.admin_profiles(user_id,display_name) values('${id(1)}','가짜 보관 검증');
      insert into public.students(id,display_name,created_by) values('${id(2)}','가짜 학생','${id(1)}');
      insert into public.assignments(id,title,dataset_id,range_start,range_end,question_count,english_to_korean_ratio,time_limit_seconds,timing_mode,question_time_limit_seconds,passing_score,status,created_by,retake_allowed)
        values('${id(10)}','가짜 시험','${savedMock.datasetId}',1,4,4,100,240,'per_question',5,80,'active','${id(1)}',false);
      insert into public.assignment_units(assignment_id,dataset_id,unit_id,position,is_primary)
        select '${id(10)}',dataset_id,id,sort_index,true from public.vocab_units where dataset_id='${savedMock.datasetId}';
      insert into public.assignment_students(assignment_id,student_id,assigned_by,assigned_at) values('${id(10)}','${id(2)}','${id(1)}',clock_timestamp()-interval '1 day');`);
    const questions = await scalar(`select jsonb_agg(jsonb_build_object('vocab_entry_id',id,'order_index',source_row,'direction','english_to_korean',
      'prompt',headword,'choices',jsonb_build_array('가짜 뜻 1','가짜 뜻 2','가짜 뜻 3','가짜 뜻 4'),'correct_choice_index',source_row-1) order by source_row) value
      from public.vocab_entries where dataset_id=$1 and source_row<=4`, [savedMock.datasetId]);
    await service(); const device = "b".repeat(64);
    const p = await scalar<{ preparationId: string; planHash: string }>("select public.prepare_local_quiz_v1($1,$2,$3,$4::jsonb) value", [id(2), id(10), device, JSON.stringify(questions)]);
    const plan = await scalar<{ attemptId: string; phase: string; planHash: string; items: Array<{ id: string; correctChoiceIndex: number }> }>(
      "select public.begin_local_quiz_v1($1,$2,$3,$4) value", [id(2), p.preparationId, device, p.planHash]);
    const answers = plan.items.map((q, i) => ({ id: q.id, order: i + 1, kind: "answer", choice: q.correctChoiceIndex, openedMs: i * 100, elapsedMs: i * 100 }));
    await scalar("select public.submit_local_quiz_phase_v1($1,$2,$3,$4,$5,$6,$7::jsonb,$8::jsonb) value",
      [id(2), plan.attemptId, plan.phase, device, plan.planHash, id(800), JSON.stringify(answers), JSON.stringify({ elapsedMs: 300, reason: "answered" })]);
    const studentAndOtherTables = await preservedTables();
    const untouched = await scalar("select to_jsonb(r)::text value from private.reviewed_mock_source_releases_v1 r where release_id=$1", [savedCsat.releaseId]);
    expect(await apply(first, "restore")).toMatchObject({ changed: 1 });
    expect(await preservedTables()).toEqual(studentAndOtherTables);
    expect(await scalar("select to_jsonb(r)::text value from private.reviewed_mock_source_releases_v1 r where release_id=$1", [savedCsat.releaseId])).toBe(untouched);
    expect(await scalar("select count(*)::int value from private.vocabulary_answer_receipts where attempt_id=$1", [plan.attemptId])).toBe(4);
    expect(await online()).toEqual(originalOnline);
    // A previously completed compact request must not undo this later restore.
    expect(await apply(first, "compact", requestId)).toEqual(firstResult);
    expect(await scalar("select to_jsonb(r)::text value from private.reviewed_mock_source_releases_v1 r where release_id=$1", [savedMock.releaseId])).toBe(first.parameters.p_packet.beforeText);
    await apply(second, "restore"); expect(await releaseRows()).toEqual(originalRows);
  });
  it("denies app roles the operator functions, tables and direct calls", async () => {
    await owner();
    expect(await scalar(`select count(*)::int value from pg_proc p join pg_namespace n on n.oid=p.pronamespace
      cross join unnest(array['anon','authenticated','service_role']) role
      where n.nspname='private' and (p.proname like '%reviewed_bundle%') and has_function_privilege(role,p.oid,'execute')`)).toBe(0);
    await service(); await expect(prepare(savedMock.releaseId)).rejects.toThrow(/permission denied/);
    await expect(db.query("select * from private.reviewed_bundle_archives")).rejects.toThrow(/permission denied/);
    await owner();
  });
  it("preserves large numeric lexemes and multibyte text, detects file changes and refuses Git paths", () => {
    const id = randomUUID();
    const beforeText = `{"release_id":"${id}","target_project_ref":"${project}","n":9007199254740993,"k":"한글\\n인용\\\""}`;
    const file = save({ id, beforeText });
    expect(loadReviewedBundleArchive(file.path, file.sha256).parameters.p_packet.beforeText).toBe(beforeText);
    fs.appendFileSync(file.path, " "); expect(() => loadReviewedBundleArchive(file.path, file.sha256)).toThrow("내용이 달라졌습니다");
    const envelope = { schemaVersion: "reviewed-bundle-archive-v1" as const, hashFormat: "postgres-jsonb-text-sha256-v1" as const,
      origin: "local-synthetic" as const, targetProjectRef: project, packet: { id, beforeText } };
    expect(() => saveReviewedBundleArchive(process.cwd(), envelope)).toThrow("모든 Git 저장소 밖");
    expect(() => saveReviewedBundleArchive(directory, { ...envelope, targetProjectRef: "xdxhswjgksukjmpbzqgz" })).toThrow("대상 환경");
    expect(() => saveReviewedBundleArchive(directory, { ...envelope, packet: { id, beforeText: "한".repeat(5_592_406) } })).toThrow("보관 크기");
  });
});
