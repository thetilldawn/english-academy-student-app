import { createHash, randomUUID } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { sha256CanonicalJson } from "@/lib/vocab/exam-use-import-contract";
import { type ReviewedMockBundle } from "@/lib/vocab/reviewed-mock-import-contract";
import { createFinalSchemaDatabase } from "@/test-support/final-schema-database";
import { buildReviewedCsatFixture, buildReviewedMockFixture, resealMockReview } from "@/test-support/reviewed-mock-wordbook-fixture";
import { loadExamUsePackageArchive, saveExamUsePackageArchive } from "../../../scripts/exam-use-package-archive";

import { loadReviewedResourceArchive, saveReviewedResourceArchive } from "../../../scripts/reviewed-resource-archive";
import { libraryCatalogSchema } from "@/features/wordbook-compositions/contracts/library";

const project = "wojxpruvbjzbhrpmsbuy", migration = "20261003230000_share_reviewed_resource_evidence.sql";
const digest = (s: string) => createHash("sha256").update(s).digest("hex");
const id = (n: number) => `a8080000-0000-4000-8000-${String(n).padStart(12, "0")}`;
type Packet = { projectRef: string; rows: Array<{ releaseId: string; sourceRow: number; beforeText: string }> };
type Key = { releaseId: string; sourceRow: number };
type File = ReturnType<typeof saveReviewedResourceArchive>;
type Imported = { datasetId: string; releaseId: string; idempotent: boolean };
type Plan = { attemptId: string; phase: string; planHash: string; items: Array<{ id: string; correctChoiceIndex: number }> };
type Batch = { accepted: unknown[]; retryTargets: string[]; result: { state: string; attempt: { finalScore: number; passed: boolean } } };
type Draft = { sources: string[]; questions: string; material: string };
const mock = buildReviewedMockFixture(8701), csat = buildReviewedCsatFixture(2025, 8702);
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

describe.sequential("reviewed resources share immutable evidence across releases and preserve old readers", () => {
  let db: PGlite, first: File, second: File, a: Imported, b: Imported;
  let firstResult: unknown, preRows: unknown, preOnline: Awaited<ReturnType<typeof online>>;
  let preTables: Record<string, unknown>;
  let preFunctions: unknown, running: Plan, draft: Draft;
  let libraryBefore: unknown, libraryScopeIds: string[], compositionBefore: string;
  const request = randomUUID(), directory = fs.mkdtempSync(path.join(os.tmpdir(), "exam-package-"));
  const scalar = async <T>(sql: string, args: unknown[] = []) => {
    try { return (await db.query<{ value: T }>(sql, args)).rows[0]!.value; }
    catch (error) { const e = error as Error & { where?: string; internalQuery?: string }; throw new Error(`${e.message}; ${sql}; ${e.where ?? ""}; ${e.internalQuery ?? ""}`); }
  };
  const owner = () => db.exec("reset role; set statement_timeout='30s'; set lock_timeout='1s'; set TimeZone='UTC'; set DateStyle='ISO, MDY'");
  const service = () => db.exec(`set role service_role; select set_config('request.jwt.claim.role','service_role',false);
    select set_config('request.jwt.claims','{"ref":"${project}","role":"service_role"}',false)`);
  const admin = () => db.exec(`set role authenticated; select set_config('request.jwt.claim.sub','${id(1)}',false);
    select set_config('request.jwt.claim.role','authenticated',false); select set_config('request.jwt.claims','{"role":"authenticated"}',false)`);
  const rows = () => scalar("select jsonb_agg(to_jsonb(r) order by release_id,source_row) value from private.reviewed_mock_source_resources_v1 r");
  const keys = (releaseId: string) => scalar<Key[]>("select jsonb_agg(jsonb_build_object('releaseId',release_id,'sourceRow',source_row) order by source_row) value from private.reviewed_mock_source_resources_v1 where release_id=$1", [releaseId]);
  const save = (packet: Packet) => saveReviewedResourceArchive(directory, { schemaVersion: "reviewed-resource-archive-v1",
    hashFormat: "postgres-jsonb-text-sha256-v1", origin: "local-synthetic", targetProjectRef: project, packet });
  const prepare = async (list: Key[]) => save(await scalar<Packet>("select private.prepare_reviewed_resource_archive_v1($1::jsonb,$2) value", [JSON.stringify(list), project]));
  const applyPacket = (p: Packet, action = "compact", key = randomUUID(), sha = first.sha256) =>
    scalar<{ changed: number }>("select private.apply_reviewed_resource_archive_v1($1,$2,$3,$4,$5::jsonb) value",
      [key, action, project, sha, JSON.stringify(p)]);
  const apply = (file: File, action = "compact", key = randomUUID()) => {
    const p = loadReviewedResourceArchive(file.path, file.sha256).parameters;
    return applyPacket(p.p_packet, action, key, file.sha256);
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
      ${all ? "" : "and c.relname not in ('reviewed_mock_source_resources_v1','reviewed_evidence_objects','reviewed_resource_archives','reviewed_resource_archive_receipts','reviewed_resource_write_permits')"}
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
    return scalar(`select jsonb_build_object('oid',oid,'owner',proowner,'security',prosecdef,'settings',proconfig,'acl',proacl) value
      from pg_proc where oid='public.list_reviewed_mock_source_resources_v1(bigint[])'::regprocedure`);
  }
  async function publicPayloads() {
    await owner();
    const ids=await scalar<number[]>("select array_agg(vocab_entry_id order by vocab_entry_id) value from private.reviewed_mock_source_resources_v1 where release_id=any($1::uuid[]) and vocab_entry_id is not null",[[a.releaseId,b.releaseId]]);
    await service();
    return (await db.query("select vocab_entry_id,payload::text from public.list_reviewed_mock_source_resources_v1($1::bigint[]) order by vocab_entry_id",[ids])).rows;
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
  async function libraryImport(key: string) {
    await owner();
    const sourceRows=(await db.query<{source_row:number;row_hash:string;unit_id:string}>("select source_row,lower(row_sha256) row_hash,unit_id from public.vocab_entries where dataset_id=$1 order by source_row",[a.datasetId])).rows;
    const bundle={schemaVersion:"vocabulary-library-import-v1",sourceCatalogHash:digest(key+"catalog"),linksHash:digest(key+"links"),referenceCatalogHash:digest(key+"refs"),
      scopes:[...new Set(sourceRows.map(r=>r.unit_id))].map((unit,index)=>({key:key+index,name:"가짜 범위 "+index,sourceTitle:"가짜 원고",
        source:{datasetId:a.datasetId,unitId:unit,kind:"exam_use",releaseId:a.releaseId,releaseVersion:mock.package.package_version,fileHash:digest(key),locator:key+".json"},
        classification:{kind:"mock",sourceGrade:"g12",exam:{executionYear:2025,examMonth:9,examKind:"mock",academicYear:null,agency:"가짜",typeCode:"long",typeLabel:"장문독해",questionNumbers:[41,42],sharedPassage:true},lesson:null,day:null,publisher:null,school:null,targetGrade:null,schoolYear:null,semester:null,assessment:null,purpose:null},
        rows:sourceRows.filter(r=>r.unit_id===unit).map(r=>({sourceRow:r.source_row,rowHash:r.row_hash,resources:{entryHash:r.row_hash,linkRecordHash:digest(key+r.source_row),selected:{schemaVersion:"vocabulary-resource-snapshot-v1",sourceFields:{raw:"가짜 원고"},proofs:{},pronunciation:{displayKo:"가짜",segments:[{text:"가짜",stress:"primary"}],variantId:"fake",audioUrl:null,available:false},lexicalPos:"noun",dictionary:null,senseId:null,definitionEn:null,exampleEn:null,exampleKo:null}}}))}))};
    const input=JSON.stringify(bundle);
    await db.query("insert into private.vocabulary_library_import_approvals values($1,$2,private.reviewed_exam_sha256_v1($3::jsonb),$4,'fake-occurrence')",[project,digest(input),input,bundle.scopes.length]);
    await service(); await scalar("select public.import_vocabulary_library_v1($1) value",[input]);
    await admin(); const catalog=libraryCatalogSchema.parse(await scalar("select public.list_vocabulary_library_v1() value"));
    return catalog.scopes.filter(scope=>scope.source.locator === key+".json").map(scope=>scope.id);
  }
  async function libraryState() {
    await owner();
    const batch = await scalar<Record<string,string>>("select private.vocabulary_library_source_states_v1($1::uuid[]) value",[libraryScopeIds]);
    const singles = await scalar<Record<string,string>>(`select jsonb_object_agg(id,private.vocabulary_library_source_state_values_v1(id,dataset_id,unit_id,source_kind,source_release_id,source_version)) value
      from private.vocabulary_library_scopes where id=any($1::uuid[])`,[libraryScopeIds]);
    expect(Object.keys(batch)).toHaveLength(2); expect(Object.values(batch)).toEqual(["available","available"]);
    expect(singles).toEqual(batch); return { batch, singles };
  }
  async function compose(key: string) {
    await owner();
    const scopes=await scalar<Array<{id:string;version:string}>>("select jsonb_agg(jsonb_build_object('id',id,'version',source_version) order by id) value from word_index.mock_wordbook_scope where source_release_id=$1",[a.releaseId]);
    await admin();
    const result=await scalar<{datasetId:string}>("select public.create_mock_wordbook_composition_v1($1::jsonb) value",[JSON.stringify({requestId:key,title:"가짜 복원 구성",scopes})]);
    return result.datasetId;
  }
  async function compactParent(releaseId: string) {
    await owner();
    const packet=await scalar<{id:string;projectRef:string;beforeText:string}>("select private.prepare_exam_use_package_archive_v1($1,$2) value",[releaseId,project]);
    const file=saveExamUsePackageArchive(directory,{schemaVersion:"exam-use-package-archive-v1",hashFormat:"postgres-jsonb-text-sha256-v1",origin:"local-synthetic",targetProjectRef:project,packet});
    const p=loadExamUsePackageArchive(file.path,file.sha256).parameters;
    await scalar("select private.apply_exam_use_package_archive_v1($1,'compact',$2,$3,$4::jsonb) value",[randomUUID(),project,file.sha256,JSON.stringify(p.p_packet)]);
  }
  let prePayloads: unknown;
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
      libraryScopeIds = await libraryImport("before-occurrence-"); libraryBefore = await libraryState();
      compositionBefore = await compose(id(850));
      await compactParent(a.releaseId);
      preOnline = await online(); await owner();
      
      prePayloads=await publicPayloads(); await owner();preRows = await rows(); preTables = await tableEvidence(); preFunctions = await functionMetadata();
    } });
    await owner();
  }, 120_000);
  afterAll(async () => db?.close());

  it("installs without altering existing rows, public contract or old prepared work", async () => {
    expect(await rows()).toEqual(preRows);expect(await tableEvidence(false,true)).toEqual(preTables);
    expect(await online()).toEqual(preOnline);expect(await libraryState()).toEqual(libraryBefore);
    expect(await publicPayloads()).toEqual(prePayloads);await owner();expect(await functionMetadata()).toEqual(preFunctions);
    expect(await scalar("select status::text value from public.quiz_attempts where id=$1",[running.attemptId])).toBe("in_progress");
  });
  it("reassembles numeric lexemes, exact object variants, repeated array positions and unknown fields", async () => {
    await owner();await db.exec("begin");
    try {
      const raw=await scalar<string>(`select jsonb_set(to_jsonb(r),'{payload}',
        '{"source_evidence":{"number":1.0,"text":"preserved evidence including a precise original source location and a sufficiently detailed explanation of this fabricated testing object; retain every original character and every numeric lexeme"},
        "dictionary":{"evidence":[{"number":1,"text":"preserved evidence including a precise original source location and a sufficiently detailed explanation of this fabricated testing object; retain every original character and every numeric lexeme"},{"number":1.0,"text":"preserved evidence including a precise original source location and a sufficiently detailed explanation of this fabricated testing object; retain every original character and every numeric lexeme"},null]},
        "pos":{"evidence":[]},"definition":null,"unknown":{"evidence":[{"keep":true}]},
        "review_records":[{"evidence":[{"number":1.0,"text":"preserved evidence including a precise original source location and a sufficiently detailed explanation of this fabricated testing object; retain every original character and every numeric lexeme"},{"number":1.0,"text":"preserved evidence including a precise original source location and a sufficiently detailed explanation of this fabricated testing object; retain every original character and every numeric lexeme"},{"number":1.0,"text":"preserved evidence including a precise original source location and a sufficiently detailed explanation of this fabricated testing object; retain every original character and every numeric lexeme"},{"number":1.0,"text":"preserved evidence including a precise original source location and a sufficiently detailed explanation of this fabricated testing object; retain every original character and every numeric lexeme"},{"number":1.0,"text":"preserved evidence including a precise original source location and a sufficiently detailed explanation of this fabricated testing object; retain every original character and every numeric lexeme"},{"number":1.0,"text":"preserved evidence including a precise original source location and a sufficiently detailed explanation of this fabricated testing object; retain every original character and every numeric lexeme"}]}]}'::jsonb)::text value
        from private.reviewed_mock_source_resources_v1 r where release_id=$1 and source_row=1`,[a.releaseId]);
      const hashes=await scalar<string[]>("select array[private.reviewed_bundle_row_sha256_v1($1::jsonb#>'{payload,source_evidence}')] value",[raw]);
      const reference=await scalar("select private.reviewed_resource_reference_v1($1::jsonb,$2::text[]) value",[raw,hashes]);
      await db.query("insert into private.reviewed_evidence_objects select $2,$1::jsonb#>'{payload,source_evidence}'",[raw,hashes[0]]);
      await db.query(`with r as(select $1::jsonb doc,$2::jsonb ref) insert into private.reviewed_resource_archives
        (release_id,source_row,target_project_ref,original_sha256,identity_sha256,entry_sha256,reference_sha256,evidence_hashes,original_bytes,state)
        select (doc->>'release_id')::uuid,(doc->>'source_row')::int,$3,private.reviewed_bundle_row_sha256_v1(doc),private.reviewed_bundle_row_sha256_v1(doc-'payload'),
        private.reviewed_bundle_row_sha256_v1(doc->'payload'),private.reviewed_bundle_row_sha256_v1(ref),$4,octet_length(doc::text),'compacted' from r`,[raw,JSON.stringify(reference),project,hashes]);
      expect(await scalar("select private.restore_reviewed_resource_v1(jsonb_set($1::jsonb,'{payload}',$2::jsonb))::text value",[raw,JSON.stringify(reference)])).toBe(raw);
      expect(await scalar("select ($1::jsonb#>'{__reviewed_resource_ref_v1,dictionary,evidence,0,number}')::text value",[JSON.stringify(reference)])).toBe("1");
      expect(await scalar("select $1::jsonb#>'{__reviewed_resource_ref_v1,unknown}' value",[JSON.stringify(reference)])).toEqual({evidence:[{keep:true}]});
    } finally {await db.exec("rollback");}
  });
  it("prepares 1 to 100 original rows atomically and reissues a lost response without storing bodies", async () => {
    first=await prepare(await keys(a.releaseId));second=await prepare(await keys(b.releaseId));
    expect(first.parameters.p_packet.rows).toHaveLength(6);expect(second.parameters.p_packet.rows).toHaveLength(100);
    expect(await scalar("select count(*)::int value from private.reviewed_evidence_objects")).toBe(0);
    expect(await scalar("select private.prepare_reviewed_resource_archive_v1($1::jsonb,$2) value",[JSON.stringify(await keys(a.releaseId)),project])).toEqual(first.parameters.p_packet);
    const before=await tableEvidence(true),dup=(await keys(a.releaseId))[0]!;
    await expect(prepare([...await keys(a.releaseId),...await keys(b.releaseId)])).rejects.toThrow("keys_invalid");
    await expect(prepare([dup,{...dup,releaseId:dup.releaseId.toUpperCase()}])).rejects.toThrow("duplicate_key");
    expect(await tableEvidence(true)).toEqual(before);
  });
  it("rejects a partial compact packet that cannot pay for a new shared object", async () => {
    await owner();const before=await tableEvidence(true);
    await expect(applyPacket({...first.parameters.p_packet,rows:first.parameters.p_packet.rows.slice(0,1)})).rejects.toThrow("batch_not_smaller");
    expect(await tableEvidence(true)).toEqual(before);
  });
  it("stores repeated evidence once across 106 resources and returns identical retired or active payloads", async () => {
    firstResult=await apply(first,"compact",request);expect(firstResult).toMatchObject({changed:6});expect(await apply(second)).toMatchObject({changed:100});
    expect(await scalar("select count(*)::int value from private.reviewed_evidence_objects")).toBe(1);
    for(const row of [...first.parameters.p_packet.rows,...second.parameters.p_packet.rows]){
      expect(await scalar("select private.restore_reviewed_resource_v1(to_jsonb(r))::text value from private.reviewed_mock_source_resources_v1 r where release_id=$1 and source_row=$2",[row.releaseId,row.sourceRow])).toBe(row.beforeText);
    }
    expect(await tableEvidence(false,true)).toEqual(preTables);expect(await publicPayloads()).toEqual(prePayloads);
    expect(await online()).toEqual(preOnline);expect(await libraryState()).toEqual(libraryBefore);await owner();
    expect(await functionMetadata()).toEqual(preFunctions);expect(await apply(first,"compact",request)).toEqual(firstResult);
    await expect(prepare(await keys(a.releaseId))).rejects.toThrow("archive_file_required");
    expect(await scalar("select count(*)::int value from private.reviewed_resource_write_permits")).toBe(0);
    await db.exec("begin");try{
      await db.query("update word_index.app_exam_use_release set status='retired',retired_at_utc=clock_timestamp() where release_id=$1",[b.releaseId]);
      expect(await publicPayloads()).toEqual(prePayloads);
    }finally{await owner();await db.exec("rollback");}
    await service();await expect(db.query("select * from public.list_reviewed_mock_source_resources_v1($1::bigint[])",[Array(401).fill(1)])).rejects.toThrow("resource_limit");await owner();
  });
  it("keeps old and new library scopes and compositions usable", async () => {
    expect(await libraryImport("after-resource-")).toHaveLength(2);const composed=await compose(id(851));await owner();
    expect(await scalar("select count(*)::int value from word_index.app_exam_use_occurrence where dataset_id=$1",[composed])).toBe(6);
    expect(await scalar("select count(*)::int value from word_index.app_exam_use_occurrence where dataset_id=$1",[compositionBefore])).toBe(6);
    expect(await libraryState()).toEqual(libraryBefore);
  });
  it("saves the first old wrong-review draft and replays it without additional records", async () => {
    expect(await fingerprint(draft)).toBe(draft.material);
    const saved = await createDraftAssignment(); expect(saved).toMatch(/^[a-f0-9-]{36}$/);
    const after = await tableEvidence(); expect(await createDraftAssignment()).toBe(saved);
    expect(await tableEvidence()).toEqual(after);
  });
  it("accepts an old in-progress exam, retry and both lost-response replays", async () => {
    const initial = await submit(id(2), running, i => i < 2, id(820)); expect(initial.retryTargets).toHaveLength(2);
    const retry = await scalar<Plan>("select public.begin_local_quiz_retry_v1($1,$2,$3) value", [id(2), running.attemptId, device]);
    const finished = await submit(id(2), retry, () => true, id(821));
    expect(finished.result.attempt).toMatchObject({ finalScore: 100, passed: true });
    const after = await tableEvidence();
    expect(await submit(id(2), running, i => i < 2, id(820))).toEqual(initial);
    expect(await submit(id(2), retry, () => true, id(821))).toEqual(finished);
    expect(await tableEvidence()).toEqual(after);
  });
  it("rolls back every earlier row in a batch whose last original is forged", async () => {
    await owner(); const before = await tableEvidence(true), originals = await rows();
    const bad = structuredClone(first.parameters.p_packet);
    bad.rows[5]!.beforeText = bad.rows[5]!.beforeText.replace("가짜", "변조");
    await expect(applyPacket(bad, "restore")).rejects.toThrow("archive_changed");
    expect(await tableEvidence(true)).toEqual(before); expect(await rows()).toEqual(originals);
    await expect(apply(first, "restore", request)).rejects.toThrow("request_reused");
    await expect(applyPacket({ ...first.parameters.p_packet, projectRef: "xdxhswjgksukjmpbzqgz" })).rejects.toThrow("packet_invalid");
    await db.exec("begin isolation level repeatable read");
    try { await expect(apply(first)).rejects.toThrow("transaction_limits"); } finally { await db.exec("rollback"); }
    await db.exec("set statement_timeout=0"); await expect(apply(first)).rejects.toThrow("transaction_limits"); await owner();
    expect(await tableEvidence(true)).toEqual(before);
  });
  it("keeps original guards and fails clearly for corrupt references with no fallback", async () => {
    await owner();
    for (const sql of ["update private.reviewed_mock_source_resources_v1 set payload='{}' where release_id=$1", "update private.reviewed_mock_source_resources_v1 set exam_input_hash=repeat('b',64) where release_id=$1", "delete from private.reviewed_mock_source_resources_v1 where release_id=$1"]) {
      await expect(db.query(sql, [a.releaseId])).rejects.toThrow("immutable");
    }
    await db.exec("begin");
    try {
      await db.query("update private.reviewed_resource_archives set entry_sha256=repeat('0',64) where release_id=$1 and source_row=1", [a.releaseId]);
      await expect(scalar("select private.restore_reviewed_resource_v1(to_jsonb(r)) value from private.reviewed_mock_source_resources_v1 r where release_id=$1 and source_row=1", [a.releaseId])).rejects.toThrow("content_changed");
    } finally { await db.exec("rollback"); }
    const before = await tableEvidence(true);
    await db.exec("begin"); try { expect(await apply(first, "restore")).toMatchObject({ changed: 6 }); } finally { await db.exec("rollback"); }
    expect(await tableEvidence(true)).toEqual(before);
  });
  it("restores a selected original after new answers and preserves every other current row", async () => {
    await owner(); const before = await tableEvidence(), all = await rows();
    const selected = first.parameters.p_packet.rows[0]!;
    expect(await applyPacket({ ...first.parameters.p_packet, rows: [selected] }, "restore")).toMatchObject({ changed: 1 });
    expect(await tableEvidence()).toEqual(before);
    const expected = (all as Array<Record<string, unknown>>).map(r => r.release_id === selected.releaseId && r.source_row === selected.sourceRow ? JSON.parse(selected.beforeText) : r);
    expect(await rows()).toEqual(expected);
    expect(await apply(first, "restore")).toMatchObject({ changed: 5 }); expect(await apply(second, "restore")).toMatchObject({ changed: 100 });
    expect(await tableEvidence()).toEqual(before);
    expect(await scalar("select private.prepare_reviewed_resource_archive_v1($1::jsonb,$2) value", [JSON.stringify(await keys(a.releaseId)), project])).toEqual(first.parameters.p_packet);
    expect(await apply(first, "compact", request)).toEqual(firstResult);
    expect(await scalar("select bool_and(state='restored') value from private.reviewed_resource_archives")).toBe(true);
  });
  it("discovers newly registered sources and rejects reserved markers and app access", async () => {
    const extra=buildReviewedMockFixture(8703),added=await approveImport(extra);await owner();
    const candidates=await scalar<Key[]>("select private.list_reviewed_resource_candidates_v1($1) value",[project]);
    expect(candidates.filter(c=>c.releaseId===added.releaseId)).toHaveLength(6);
    const snapshot=await tableEvidence(true);
    await expect(db.query("update private.reviewed_evidence_objects set evidence='{}'")).rejects.toThrow();
    await expect(db.query("delete from private.reviewed_evidence_objects")).rejects.toThrow();
    await expect(db.query("insert into private.reviewed_evidence_objects values(repeat('b',64),'{}')")).rejects.toThrow();
    await expect(db.query("insert into private.reviewed_mock_source_resources_v1(release_id,source_row,exam_input_hash,payload) values($1,999,repeat('a',64),'{\"__reviewed_resource_ref_v1\":{}}')",[a.releaseId])).rejects.toThrow("reserved_marker");
    expect(await tableEvidence(true)).toEqual(snapshot);
    expect(await scalar(`select count(*)::int value from pg_proc p join pg_namespace n on n.oid=p.pronamespace
      cross join unnest(array['anon','authenticated','service_role']) role where n.nspname='private'
      and p.proname like '%reviewed_resource%v1' and has_function_privilege(role,p.oid,'execute')`)).toBe(0);
    await service();await expect(prepare([{releaseId:a.releaseId,sourceRow:1}])).rejects.toThrow("permission denied");
    await expect(db.query("select * from private.reviewed_evidence_objects")).rejects.toThrow("permission denied");await owner();
  });
  it("keeps original numeric strings in files and rejects corrupt or duplicate archives", () => {
    const releaseId = randomUUID(), beforeText = `{"release_id":"${releaseId}","source_row":1,"number":9007199254740993,"decimal":1.0,"text":"가짜\\n원문"}`;
    const packet = { projectRef: project, rows: [{ releaseId, sourceRow: 1, beforeText }] }, file = save(packet);
    expect(loadReviewedResourceArchive(file.path, file.sha256).parameters.p_packet.rows[0]!.beforeText).toBe(beforeText);
    fs.appendFileSync(file.path, " "); expect(() => loadReviewedResourceArchive(file.path, file.sha256)).toThrow("내용이 달라졌습니다");
    expect(() => save({ ...packet, rows: [...packet.rows, ...packet.rows] })).toThrow("중복");
    expect(() => save({ ...packet, rows: [{ ...packet.rows[0]!, beforeText: "한".repeat(349_526) }] })).toThrow("보관 크기");
    expect(() => saveReviewedResourceArchive(process.cwd(), { schemaVersion: "reviewed-resource-archive-v1", hashFormat: "postgres-jsonb-text-sha256-v1", origin: "local-synthetic", targetProjectRef: project, packet })).toThrow("모든 Git 저장소 밖");
  });
});

