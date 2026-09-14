import { createHash } from "node:crypto";

import type { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { sha256CanonicalJson } from "@/lib/vocab/exam-use-import-contract";
import { sealReviewedMockBundle, type ReviewedMockBundle } from "@/lib/vocab/reviewed-mock-import-contract";
import { createFinalSchemaDatabase } from "@/test-support/final-schema-database";
import { buildReviewedMockFixture, resealMockReview } from "@/test-support/reviewed-mock-wordbook-fixture";

const project = "wojxpruvbjzbhrpmsbuy";
const digest = (text: string) => createHash("sha256").update(text).digest("hex");
const expectedLinks = { dictionary: 6, pos: 6, pronunciation: 0, definition: 1, example: 1 };

describe.sequential("reviewed monthly sources and preserved original fields", () => {
  let db: PGlite;
  let saved: { datasetId: string; releaseId: string; registeredScopeCount: number };
  const fixture = buildReviewedMockFixture();
  const scalar = async <T>(query: string, params: unknown[] = []) => (await db.query<{ value: T }>(query, params)).rows[0]!.value;
  const importBundle = (bundle: ReviewedMockBundle) => scalar<Record<string, unknown>>("select public.import_reviewed_mock_wordbook_v1($1) value", [JSON.stringify(bundle)]);
  const approve = async (bundle: ReviewedMockBundle, links = expectedLinks) => {
    await db.exec("reset role");
    await db.query(`insert into private.reviewed_mock_source_approvals_v1
      (approval_id,target_project_ref,dataset_key,bundle_file_sha256,content_sha256,package_version,occurrence_count,included_count,scope_count,expected_link_counts,review_evidence_sha256)
      values($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
    [bundle.approval_id, project, bundle.package.dataset_key, digest(JSON.stringify(bundle)), bundle.content_sha256,
      bundle.package.package_version, bundle.package.entries.length, bundle.package.entries.filter(row => row.include_in_exam).length,
      bundle.scopes.length, JSON.stringify(links), sha256CanonicalJson([...bundle.resources].sort((a, b) => a.source_row - b.source_row).map(row => row.review_records))]);
    await db.exec("set role service_role; select set_config('request.jwt.claim.role','service_role',false)");
  };
  beforeAll(async () => {
    db = await createFinalSchemaDatabase();
    await db.exec(`select set_config('request.jwt.claims','{"ref":"${project}","role":"service_role"}',false);`);
  }, 30000);
  afterAll(async () => db?.close());

  it("refuses an unapproved raw package", async () => {
    await expect(importBundle(fixture)).rejects.toThrow("reviewed_mock_not_approved");
  });
  it("does not admit monthly sources through the legacy importer", async () => {
    await db.exec("set role service_role");
    await expect(db.query("select public.import_app_exam_use_package_v1($1)", [JSON.stringify(fixture.package)])).rejects.toThrow("reviewed_mock_import_required");
    await expect(db.query("select public.import_app_exam_use_package_v1($1)", [JSON.stringify({ ...fixture.package, dataset_key: " g12-mock-2026-03-v99 " })])).rejects.toThrow("reviewed_mock_import_required");
    await expect(db.query("select private.import_app_exam_use_package_core_v1($1)", [JSON.stringify(fixture.package)])).rejects.toThrow(/permission denied/);
  });
  it("imports only a pinned source, preserves POS absence and makes original scopes available", async () => {
    await approve(fixture);
    saved = await importBundle(fixture) as typeof saved;
    expect(saved.registeredScopeCount).toBe(2);
    await db.exec("reset role");
    const entries = (await db.query<{ headword: string; primary_meaning: string; english_definition: string | null; example_ko: string | null }>(
      "select headword,primary_meaning,english_definition,example_ko from public.vocab_entries where dataset_id=$1 order by source_row", [saved.datasetId])).rows;
    expect(entries).toHaveLength(6);
    expect(entries[0]).toEqual({ headword: "fixture1", primary_meaning: "가짜 뜻 1", english_definition: "A fabricated fixture definition.", example_ko: "가짜 예문 하나." });
    const originalPos = await scalar<unknown[]>("select jsonb_agg(payload->'original_pos') value from private.reviewed_mock_source_resources_v1 where release_id=$1", [saved.releaseId]);
    expect(originalPos).toEqual(Array(6).fill(null));
    await db.exec("set role service_role");
    expect(await importBundle(fixture)).toMatchObject({ datasetId: saved.datasetId, idempotent: true });
  });
  it("blocks a post-review definition edit and all changes to the saved source", async () => {
    const changed = buildReviewedMockFixture(2);
    changed.resources[0]!.definition.value = "Modified after review.";
    sealReviewedMockBundle(changed);
    await approve(changed);
    await expect(importBundle(changed)).rejects.toThrow("reviewed_mock_entry_invalid");
    await db.exec("reset role");
    await expect(db.query("update public.vocab_entries set english_definition='overwrite' where dataset_id=$1", [saved.datasetId])).rejects.toThrow("reviewed_mock_source_immutable");
    await expect(db.query("delete from word_index.app_exam_use_occurrence where release_id=$1", [saved.releaseId])).rejects.toThrow("reviewed_mock_source_immutable");
    expect(await scalar<number>("select count(*)::int value from public.vocab_datasets where dataset_key='g12-mock-2026-03-v2'")).toBe(0);
  });
  it("rejects two passes from one reviewer and the wrong environment", async () => {
    const sameReviewer = buildReviewedMockFixture(3);
    sameReviewer.resources[0]!.review_records[1]!.reviewer = "fixture-alpha";
    sealReviewedMockBundle(sameReviewer);
    await approve(sameReviewer);
    await expect(importBundle(sameReviewer)).rejects.toThrow("reviewed_mock_entry_invalid");
    await db.exec("select set_config('request.jwt.claims','{\"ref\":\"xdxhswjgksukjmpbzqgz\"}',false)");
    await expect(importBundle(fixture)).rejects.toThrow("reviewed_mock_not_approved");
    await db.exec(`select set_config('request.jwt.claims','{"ref":"${project}"}',false);`);
  });
  it("rejects deleted available fields even when their edited row has new reviews", async () => {
    const missing = buildReviewedMockFixture(4);
    missing.resources[0]!.definition = { status: "missing", value: null, reason: "incorrectly omitted", evidence: [] };
    resealMockReview(missing);
    await approve(missing, expectedLinks);
    await expect(importBundle(missing)).rejects.toThrow("reviewed_mock_link_count_mismatch");
  });
  it("preserves excluded source rows and does not create vocabulary rows for them", async () => {
    const excluded = buildReviewedMockFixture(5);
    excluded.package.entries[5]!.include_in_exam = false;
    excluded.package.entries[5]!.exam_use_status = "excluded";
    excluded.resources[5]!.inclusion_reason = "확인되지 않은 가짜 원표현 제외";
    resealMockReview(excluded);
    await approve(excluded);
    const result = await importBundle(excluded);
    expect(result.includedCount).toBe(5);
    await db.exec("reset role");
    expect(await scalar("select vocab_entry_id value from word_index.app_exam_use_occurrence where release_id=$1 and source_row=6", [result.releaseId])).toBeNull();
  });
  it("keeps imports and evidence private while the existing admin can read scopes", async () => {
    await db.exec("reset role");
    const permissions = await scalar<boolean>(`select has_function_privilege('anon','public.import_reviewed_mock_wordbook_v1(text)','execute')
      or has_function_privilege('authenticated','public.list_reviewed_mock_source_resources_v1(bigint[])','execute') value`);
    expect(permissions).toBe(false);
    const adminId = "00000000-0000-4000-8000-000000099321";
    await db.exec(`insert into auth.users(id) values('${adminId}'); insert into public.admin_profiles(user_id,display_name) values('${adminId}','가짜 자료 관리자');
      set role authenticated; select set_config('request.jwt.claim.sub','${adminId}',false);`);
    const scopeList = await scalar<{ scopes: unknown[] }>("select public.list_mock_wordbook_scopes_v1() value");
    expect(scopeList.scopes).toHaveLength(4);
    await expect(importBundle(fixture)).rejects.toThrow(/permission denied/);
  });
});
