import fs from "node:fs";
import { createHash, randomUUID } from "node:crypto";
import { EMPTY_LIBRARY_FILTERS, libraryCatalogSchema, libraryCommandResultSchema, type LibraryCatalog, type LibraryTemplate } from "@/features/wordbook-compositions/contracts/library";
import { libraryImportSchema, type LibraryImport } from "@/features/wordbook-compositions/contracts/library-import";
import path from "node:path";

import { PGlite } from "@electric-sql/pglite";
import { pgcrypto } from "@electric-sql/pglite/contrib/pgcrypto";
import {
  afterAll,
  beforeAll,
  describe,
  expect,
  it,
} from "vitest";

import {
  computeExamUseEntryContentHash,
  computeExamUsePackageVersion,
  validateExamUsePackage,
} from "@/lib/vocab/exam-use-import-contract";

const migrationsDirectory = path.resolve("supabase/migrations");
const migrationPaths = fs
  .readdirSync(migrationsDirectory)
  .filter((name) => name.endsWith(".sql"))
  .sort()
  .map((name) => path.join(migrationsDirectory, name));

const ids = {
  admin: "00000000-0000-4000-8000-000000009001",
  student: "00000000-0000-4000-8000-000000009002",
} as const;

function buildEntry(sourceRow: number) {
  const suffix = String(sourceRow).padStart(12, "0");
  const entry: Record<string, unknown> = {
    source_row: sourceRow,
    sequence_no: sourceRow,
    unit: "2025-01 장문독해",
    day: null,
    position_in_unit: sourceRow,
    dictionary_id: `word:integration-${sourceRow}`,
    legacy_ids: [
      {
        system: "legacy-word-index",
        id: `00000000-0000-4000-8000-${suffix}`,
      },
    ],
    sense_id: null,
    pronunciation_variant_id: `mw:integration-${sourceRow}`,
    display_headword: `integration${sourceRow}`,
    display_gloss_ko: `통합 ${sourceRow}`,
    display_pronunciation_ko: `인티그레이션 ${sourceRow}`,
    display_pronunciation_review_status: "candidate",
    audio: {
      status: "raw_attached",
      audio_url:
        `https://media.merriam-webster.com/audio/prons/en/us/mp3/i/integration${sourceRow}.mp3`,
      sound_audio: `integration${sourceRow}`,
      raw_response_sha256: "a".repeat(64),
      raw_source: "api_raw",
      raw_relative_path: `pron-integration-${sourceRow}.json`,
      reason: null,
      selection_status: "single_exact_raw_variant",
      source_locator: `meta.id=integration${sourceRow} hwi.prs[0]`,
      variant_id: `mw:integration-${sourceRow}`,
      variant_pos: "noun",
      mw_notation: `in-te-gra-tion-${sourceRow}`,
    },
    occurrence_id: `occ:integration-${sourceRow}`,
    occurrence_content_hash: sourceRow.toString(16).padStart(64, "b"),
    content_hash: "0".repeat(64),
    exam_review_id: `exam-review:integration-${sourceRow}`,
    exam_input_hash: sourceRow.toString(16).padStart(64, "c"),
    exam_use_status: "reviewed_for_preview",
    context_evidence_status: "source_entry_context",
    context_evidence: {
      source: "source_entries",
      source_entry_id: `entry-integration-${sourceRow}`,
      source_entry_sha256: sourceRow.toString(16).padStart(64, "d"),
    },
    entry_row_sha256: sourceRow
      .toString(16)
      .toUpperCase()
      .padStart(64, "E"),
    source_entry_id: `entry-integration-${sourceRow}`,
    source_entry_sha256: sourceRow.toString(16).padStart(64, "d"),
    include_in_exam: true,
    manual_review_flags: [],
  };
  entry.content_hash = computeExamUseEntryContentHash(entry);
  return entry;
}

function buildPackage() {
  const input: Record<string, unknown> = {
    schema_version: "1.0",
    package_type: "student-app-exam-use-wordbook",
    target_environment: "preview",
    common_dictionary_release_allowed: false,
    exam_use_import_allowed: true,
    package_version: "0".repeat(64),
    dataset_key: "integration-exam-use-v1",
    source_sha256: "1".repeat(64),
    candidate_dictionary_version: "2".repeat(64),
    manifest_content_hash: "3".repeat(64),
    exam_review_ledger_sha256: "4".repeat(64),
    wordbook_id: "integration-wordbook",
    title: "통합 테스트용 가짜 단어장",
    generated_at_utc: "2026-08-07T00:00:00Z",
    entries: [1, 2, 3, 4].map(buildEntry),
  };
  input.package_version = computeExamUsePackageVersion(input);
  validateExamUsePackage(input);
  return input;
}

async function createFinalSchemaDatabase() {
  const database = new PGlite({ extensions: { pgcrypto } });
  await database.exec(`
    create role anon nologin;
    create role authenticated nologin;
    create role service_role nologin;
    create schema auth;
    create schema cron;
    create schema extensions;
    create table cron.job (
      jobid bigint generated always as identity primary key,
      jobname text not null unique,
      schedule text not null,
      command text not null
    );
    create function cron.schedule(
      p_jobname text,
      p_schedule text,
      p_command text
    ) returns bigint language plpgsql as $$
    declare scheduled_job_id bigint;
    begin
      insert into cron.job (jobname, schedule, command)
      values (p_jobname, p_schedule, p_command)
      on conflict (jobname) do update
      set schedule = excluded.schedule,
          command = excluded.command
      returning jobid into scheduled_job_id;
      return scheduled_job_id;
    end;
    $$;
    create table auth.users (id uuid primary key);
    create function auth.uid()
    returns uuid language sql stable set search_path = '' as $$
      select nullif(
        current_setting('request.jwt.claim.sub', true),
        ''
      )::uuid;
    $$;
    create function auth.role()
    returns text language sql stable set search_path = '' as $$
      select nullif(
        current_setting('request.jwt.claim.role', true),
        ''
      );
    $$;
    create function auth.jwt()
    returns jsonb language sql stable set search_path = '' as $$
      select coalesce(
        nullif(current_setting('request.jwt.claims', true), ''),
        '{}'
      )::jsonb;
    $$;
  `);
  for (const migrationPath of migrationPaths) {
    const migration = fs
      .readFileSync(migrationPath, "utf8")
      .replace("create extension if not exists pg_cron;", "");
    try {
      await database.exec(migration);
    } catch (error) {
      throw new Error(
        `migration failed: ${path.basename(migrationPath)}: ${error instanceof Error ? error.message : String(error)}`,
        { cause: error },
      );
    }
  }
  return database;
}

describe.sequential("vocabulary library: reviewed source ranges and immutable templates", () => {
  let db: PGlite;
  let bundle: LibraryImport;
  let catalog: LibraryCatalog;
  let saved: LibraryTemplate;
  const meta = { title: "가짜 여러 범위", tags: ["주제", "직전 대비"], school: null, targetGrade: "g12", schoolYear: 2026, semester: 2 as const, assessment: null, purpose: "시험 준비" };
  const admin = () => db.exec(`reset role; set role authenticated; select set_config('request.jwt.claim.sub','${ids.admin}',false); select set_config('request.jwt.claim.role','authenticated',false);`);
  const service = () => db.exec("reset role; set role service_role; select set_config('request.jwt.claim.role','service_role',false);");
  async function list() {
    const r = await db.query<{ result: unknown }>("select public.list_vocabulary_library_v1() result");
    return libraryCatalogSchema.parse(r.rows[0]!.result);
  }
  async function save(input: unknown) {
    const r = await db.query<{ result: unknown }>("select public.save_vocabulary_library_template_v1($1::jsonb) result", [JSON.stringify(input)]);
    return libraryCommandResultSchema.parse(r.rows[0]!.result).template;
  }
  function recipe(indexes = [0, 1, 2]) {
    return { filters: EMPTY_LIBRARY_FILTERS, scopes: indexes.map(i => ({ id: catalog.scopes[i]!.id, version: catalog.scopes[i]!.version })), excludedOccurrenceKeys: [] as string[], scopeStatus: "confirmed" as const };
  }
  async function approve(input: LibraryImport) {
    const text = JSON.stringify(input);
    const hash = createHash("sha256").update(text).digest("hex");
    await db.exec("reset role");
    await db.query(`insert into private.vocabulary_library_import_approvals(target_project_ref,file_sha256,content_sha256,scope_count,approval_id)
      values('wojxpruvbjzbhrpmsbuy',$1,private.reviewed_exam_sha256_v1($2::jsonb),$3,'fake-library-approval') on conflict do nothing`, [hash, text, input.scopes.length]);
    await service();
    return text;
  }
  beforeAll(async () => {
    db = await createFinalSchemaDatabase();
    await db.exec(`insert into auth.users(id) values('${ids.admin}'); insert into public.admin_profiles(user_id,display_name) values('${ids.admin}','가짜 관리자');
      select set_config('request.headers','{"host":"wojxpruvbjzbhrpmsbuy.supabase.co"}',false);`);
    const pack = buildPackage();
    const held = buildEntry(5); held.include_in_exam = false; held.exam_use_status = "review_required"; held.content_hash = computeExamUseEntryContentHash(held);
    const excluded = buildEntry(6); excluded.include_in_exam = false; excluded.exam_use_status = "excluded"; excluded.content_hash = computeExamUseEntryContentHash(excluded);
    (pack.entries as unknown[]).push(held, excluded); pack.package_version = computeExamUsePackageVersion(pack);
    await service();
    const result = await db.query<{ result: { datasetId: string; releaseId: string } }>("select public.import_app_exam_use_package_v1($1::jsonb) result", [JSON.stringify(pack)]);
    const source = result.rows[0]!.result;
    await db.exec("reset role");
    await db.query("insert into public.vocab_dataset_catalog(dataset_id,display_name,catalog_group,material_kind,grade_code) values($1,'가짜 시험 자료','high_mock','wordbook','g12')", [source.datasetId]);
    const unit = (await db.query<{ id: string }>("select id from public.vocab_units where dataset_id=$1", [source.datasetId])).rows[0]!.id;
    const rows = (await db.query<{ source_row: number; hash: string; entry_hash: string | null }>(`select o.source_row,lower(coalesce(e.row_sha256,o.occurrence_content_hash)) hash,lower(e.row_sha256) entry_hash
      from word_index.app_exam_use_occurrence o left join public.vocab_entries e on e.id=o.vocab_entry_id where o.release_id=$1 order by o.source_row`, [source.releaseId])).rows;
    const classification = { kind: "mock" as const, sourceGrade: "g12", exam: { executionYear: 2025, examMonth: 9, examKind: "mock" as const, academicYear: null, agency: "가짜", typeCode: "long", typeLabel: "장문독해", questionNumbers: [41, 42], sharedPassage: true }, lesson: null, day: null, publisher: null, school: null, targetGrade: null, schoolYear: null, semester: null, assessment: null, purpose: null };
    const makeScope = (key: string, ns: number[]) => ({ key, name: `가짜 ${key}`, sourceTitle: "가짜 원고", source: { datasetId: source.datasetId, unitId: unit, kind: "exam_use" as const, releaseId: source.releaseId, releaseVersion: String(pack.package_version), fileHash: "b".repeat(64), locator: key }, classification,
      rows: rows.filter(r => ns.includes(r.source_row)).map(r => ({ sourceRow: r.source_row, rowHash: r.hash, resources: { entryHash: r.entry_hash, linkRecordHash: "c".repeat(64), selected: { audio: { sourceRef: "fake-original", value: "fake-audio" }, pos: "noun" } } })) });
    bundle = libraryImportSchema.parse({ schemaVersion: "vocabulary-library-import-v1", sourceCatalogHash: "a".repeat(64), linksHash: "b".repeat(64), referenceCatalogHash: "c".repeat(64),
      scopes: [makeScope("part-a", [1, 2, 5]), makeScope("part-b", [2, 3, 6]), makeScope("part-c", [4])] });
    // A repeated occurrence has two independent link-record proofs.
    bundle.scopes[1]!.rows[0]!.resources.linkRecordHash = "d".repeat(64);
  }, 60000);
  afterAll(async () => { await db?.close(); });
  it("requires file-bound project approval, rejects a changed approved row, and imports only actual states", async () => {
    await service();
    await expect(db.query("select public.import_vocabulary_library_v1($1)", [JSON.stringify(bundle)])).rejects.toThrow("library_import_not_approved");
    const bad = structuredClone(bundle); bad.scopes[0]!.rows[0]!.rowHash = "f".repeat(64);
    await expect(db.query("select public.import_vocabulary_library_v1($1)", [await approve(bad)])).rejects.toThrow("library_row_or_reference_changed");
    await db.query("select public.import_vocabulary_library_v1($1)", [await approve(bundle)]);
    await admin(); catalog = await list();
    expect(catalog.scopes).toHaveLength(3);
    expect(catalog.scopes[0]!.occurrences.map(r => r.state)).toEqual(["included", "included", "held"]);
    expect(catalog.scopes[1]!.occurrences.map(r => r.state)).toEqual(["included", "included", "excluded"]);
    expect(JSON.stringify(catalog)).not.toMatch(/fake-audio|primary_meaning|entry_snapshot|correct_choice/);
  });
  it("delivers existing long-reading classification only from the matching complete parent range", async () => {
    await admin();
    const source = bundle.scopes[0]!.source;
    const read = async () => (await db.query("select * from public.list_vocabulary_unit_source_classifications_v1($1)", [source.datasetId])).rows;
    expect(await read()).toEqual([{ unit_id: source.unitId, metadata: bundle.scopes[0]!.classification.exam }]);
    await db.exec("reset role");
    await db.query("update public.vocab_units set entry_count=entry_count+1 where id=$1", [source.unitId]);
    await admin();
    expect(await read()).toEqual([]);
    await db.exec("reset role");
    await db.query("update public.vocab_units set entry_count=entry_count-1 where id=$1", [source.unitId]);
    await admin();
    expect(await read()).toEqual([{ unit_id: source.unitId, metadata: bundle.scopes[0]!.classification.exam }]);
  });
  it("combines overlapping partial units once, records held/excluded rows, and returns the same completed retry", async () => {
    const command = { action: "create", requestId: randomUUID(), metadata: meta, recipe: recipe() };
    saved = await save(command);
    expect(saved.versions[0]).toMatchObject({ number: 1, sourceCount: 6, datasetId: null });
    expect(saved.versions[0]!.includedKeys).toHaveLength(4);
    expect(await save(command)).toEqual(saved);
    await expect(save({ ...command, metadata: { ...meta, title: "변경" } })).rejects.toThrow("library_request_reused");
    await db.exec("reset role");
    const proof = await db.query<{ hashes: string[] }>(`select private.expand_vocabulary_library_occurrence_v1(fixed_composition->'occurrences'->1)->'resources'->'linkRecordHashes' hashes
      from private.vocabulary_library_versions where id=$1`, [saved.versions[0]!.id]);
    expect(proof.rows[0]!.hashes).toEqual(["c".repeat(64), "d".repeat(64)]);
    await admin();
  });
  it("expands compact references to the exact original snapshot including overlap, held rows and resource proofs", async () => {
    await db.exec("reset role");
    const result = (await db.query<{ equal: boolean; cached: number; rows: number }>(`with snapshots as (
      select private.resolve_vocabulary_library_recipe_v1($1::jsonb) original,private.resolve_vocabulary_library_recipe_compact_v1($1::jsonb) compact
    ) select jsonb_set(compact-'schemaVersion','{occurrences}',(select jsonb_agg(private.expand_vocabulary_library_occurrence_v1(value) order by ordinality)
      from jsonb_array_elements(compact->'occurrences') with ordinality))=original equal,
      (select count(*)::int from private.vocabulary_library_row_fingerprints) cached,(select count(*)::int from private.vocabulary_library_scope_rows) rows from snapshots`, [JSON.stringify(recipe())])).rows[0]!;
    expect(result.equal).toBe(true); expect(result.cached).toBe(result.rows);
    await expect(db.query("update private.vocabulary_library_row_fingerprints set document_sha256=repeat('f',64)")).rejects.toThrow("immutable");
    const row = (await db.query<{ value: unknown }>("select fixed_composition->'occurrences'->0 value from private.vocabulary_library_versions where id=$1", [saved.versions[0]!.id])).rows[0]!.value;
    await expect(db.query("select private.expand_vocabulary_library_occurrence_v1($1::jsonb || jsonb_build_object('documentHash',repeat('f',64)))", [JSON.stringify(row)])).rejects.toThrow("composition_reference_changed");
    for (const role of ["anon", "authenticated", "service_role"]) {
      await db.exec(`set role ${role}`);
      await expect(db.query("select * from private.vocabulary_library_row_fingerprints")).rejects.toThrow(/permission denied/);
      await expect(db.query("select private.cache_vocabulary_library_row_fingerprints_v1('{}')")).rejects.toThrow(/permission denied/);
      await db.exec("reset role");
    }
    await admin();
  });
  it("renames/tags without rewriting content, rejects old revision, and creates a smaller immutable version", async () => {
    const before = structuredClone(saved.versions);
    const updated = await save({ action: "metadata", requestId: randomUUID(), templateId: saved.id, expectedRevision: 1, metadata: { ...meta, title: "이름 변경", tags: ["새 태그"] } });
    expect(updated.versions).toEqual(before); expect(updated.revision).toBe(2);
    await expect(save({ action: "metadata", requestId: randomUUID(), templateId: saved.id, expectedRevision: 1, metadata: meta })).rejects.toThrow("library_template_changed");
    const r = recipe(); r.excludedOccurrenceKeys = [saved.versions[0]!.includedKeys[0]!];
    saved = await save({ action: "version", requestId: randomUUID(), templateId: saved.id, expectedRevision: 2, expectedContentHash: before[0]!.contentHash, recipe: r });
    expect(saved.versions[0]!.includedKeys).toHaveLength(3); expect(saved.versions[1]).toEqual(before[0]);
    expect(saved.versions[0]!.sourceVersionId).toBe(before[0]!.id);
  });
  it("copies the selected historical version with its exact references and allows an unconfirmed empty template", async () => {
    const original = saved.versions[1]!;
    const copy = await save({ action: "copy", requestId: randomUUID(), sourceVersionId: original.id, metadata: { ...meta, title: "복사" } });
    expect(copy.id).not.toBe(saved.id);
    expect(copy.versions[0]).toMatchObject({ contentHash: original.contentHash, includedKeys: original.includedKeys, sourceVersionId: original.id });
    const empty = await save({ action: "create", requestId: randomUUID(), metadata: { ...meta, title: "기말 미확정" }, recipe: { ...recipe([]), scopeStatus: "unconfirmed" } });
    expect(empty.versions[0]).toMatchObject({ sourceCount: 0, includedKeys: [], datasetId: null });
  });

  it("rejects new empty confirmed versions and all-excluded selections atomically", async () => {
    const before = await list();
    await expect(save({action:"create",requestId:randomUUID(),metadata:meta,recipe:recipe([])})).rejects.toThrow("library_confirmed_range_empty");
    const allExcluded=recipe(); allExcluded.excludedOccurrenceKeys=before.templates.find(t=>t.id===saved.id)!.versions[1]!.includedKeys;
    await expect(save({action:"create",requestId:randomUUID(),metadata:meta,recipe:allExcluded})).rejects.toThrow("library_confirmed_range_empty");
    await expect(save({action:"version",requestId:randomUUID(),templateId:saved.id,expectedRevision:saved.revision,expectedContentHash:saved.versions[0]!.contentHash,recipe:recipe([]),metadata:{...meta,title:"실패해야 할 변경"}})).rejects.toThrow("library_confirmed_range_empty");
    expect(await list()).toEqual(before);
  });
  it("saves version metadata in the same transaction and retains the previous content", async () => {
    const created=await save({action:"create",requestId:randomUUID(),metadata:meta,recipe:recipe()});
    const nextMetadata={...meta,title:"새 이름과 새 범위",tags:["자동 주제"]};
    const cmd={action:"version",requestId:randomUUID(),templateId:created.id,expectedRevision:created.revision,expectedContentHash:created.versions[0]!.contentHash,recipe:recipe([0]),metadata:nextMetadata};
    const updated=await save(cmd);expect(updated.metadata).toEqual(nextMetadata);expect(updated.versions[1]).toEqual(created.versions[0]);
    expect(await save(cmd)).toEqual(updated);
    await db.exec("reset role");
    const config=(await db.query<{proconfig:string[]}>("select proconfig from pg_proc where oid='public.save_vocabulary_library_template_v1(jsonb)'::regprocedure")).rows[0]!.proconfig;
    expect(config).toContain("statement_timeout=55s");await admin();
  });
  it("reads and replays historical confirmed-empty receipts without allowing new copies", async () => {
    // This isolated fake database simulates a version saved before the new guard.
    const cmd={action:"create",requestId:randomUUID(),metadata:{...meta,title:"구판 빈 확정 틀"},recipe:recipe([])};
    await db.exec("reset role; alter table private.vocabulary_library_versions disable trigger guard_new_vocabulary_library_version_v1");
    let legacy!: LibraryTemplate;
    try { await admin(); legacy=await save(cmd); }
    finally { await db.exec("reset role; alter table private.vocabulary_library_versions enable trigger guard_new_vocabulary_library_version_v1");await admin(); }
    expect((await list()).templates.some(t=>t.id===legacy.id)).toBe(true);expect(await save(cmd)).toEqual(legacy);
    await expect(save({...cmd,requestId:randomUUID()})).rejects.toThrow("library_confirmed_range_empty");
    await expect(save({action:"copy",requestId:randomUUID(),sourceVersionId:legacy.versions[0]!.id,metadata:meta})).rejects.toThrow("library_confirmed_range_empty");
    const fixed=await save({action:"version",requestId:randomUUID(),templateId:legacy.id,expectedRevision:1,expectedContentHash:legacy.versions[0]!.contentHash,recipe:recipe([0])});
    expect(fixed.versions[1]).toEqual(legacy.versions[0]);expect(fixed.versions[0]!.includedKeys.length).toBeGreaterThan(0);
  });
  it("rejects unknown selections/exclusions atomically and does not overwrite source rows or frozen resources", async () => {
    const count = (await list()).templates.length;
    const r = recipe(); r.excludedOccurrenceKeys = ["f".repeat(64)];
    await expect(save({ action: "create", requestId: randomUUID(), metadata: meta, recipe: r })).rejects.toThrow("library_exclusion_outside_scope");
    const changed = recipe(); changed.scopes[0]!.version = "f".repeat(64);
    await expect(save({ action: "create", requestId: randomUUID(), metadata: meta, recipe: changed })).rejects.toThrow("library_scope_changed");
    expect((await list()).templates).toHaveLength(count);
    await db.exec("reset role");
    const frozen = await db.query<{ audio: string; entries: number }>(`select private.expand_vocabulary_library_occurrence_v1(fixed_composition->'occurrences'->0)->'resources'->'selected'->'audio'->>'value' audio,
      (select count(*)::integer from public.vocab_entries) entries from private.vocabulary_library_versions where id=$1`, [saved.versions[0]!.id]);
    expect(frozen.rows[0]).toEqual({ audio: "fake-audio", entries: 4 });
    await expect(db.query("update private.vocabulary_library_versions set content_sha256=repeat('f',64) where id=$1", [saved.versions[0]!.id])).rejects.toThrow("immutable");
    await admin();
  });
  it.each([{}, { ...EMPTY_LIBRARY_FILTERS, years: [2024, 2024] }, { ...EMPTY_LIBRARY_FILTERS, yearFrom: 2026, yearTo: 2024 },
    { ...EMPTY_LIBRARY_FILTERS, semesters: [3] }, { ...EMPTY_LIBRARY_FILTERS, kinds: ["candidate"] },
    { ...EMPTY_LIBRARY_FILTERS, schools: ["학교A", " 학교A "] }])("rejects malformed filter payloads at the database boundary", async filters => {
    await expect(save({ action: "create", requestId: randomUUID(), metadata: meta, recipe: { ...recipe([]), filters, scopeStatus: "unconfirmed" } }))
      .rejects.toThrow(/invalid_library_filter/);
    expect(libraryCatalogSchema.safeParse(await list()).success).toBe(true);
  });
  it("accepts a real direct-registration DAY without fabricating a source release or merging equal spellings", async () => {
    await db.exec("reset role");
    const d = (await db.query<{ id: string }>(`insert into public.vocab_datasets(dataset_key,title,source_label,source_sha256,row_count,status,is_active)
      values('fake-library-day','가짜 DAY','fake',repeat('A',64),4,'ready',true) returning id`)).rows[0]!.id;
    const u = (await db.query<{ id: string }>(`insert into public.vocab_units(dataset_id,unit_label,normalized_label,unit_kind,unit_number,sort_index,entry_count)
      values($1,'DAY 1','day:1','day',1,1,4) returning id`, [d])).rows[0]!.id;
    // Existing directly registered DAY books can have no catalog metadata row.
    await db.query(`insert into public.vocab_entries(dataset_id,source_row,headword,headword_normalized,meanings,primary_meaning,row_sha256,unit_id,position_in_unit,entry_type)
      select $1,n,'same','same',array['가짜 뜻 '||n],'가짜 뜻 '||n,upper(encode(extensions.digest('fake:'||n,'sha256'),'hex')),$2,n,'word' from generate_series(1,4) n`, [d, u]);
    const rows = (await db.query<{ source_row: number; hash: string }>("select source_row,lower(row_sha256) hash from public.vocab_entries where dataset_id=$1 order by source_row", [d])).rows;
    const input = structuredClone(bundle);
    input.scopes = [{ ...input.scopes[0]!, key: "fake-day-1", name: "DAY 1", sourceTitle: "가짜 일반 단어장",
      source: { ...input.scopes[0]!.source, datasetId: d, unitId: u, kind: "legacy_vocab", releaseId: null, releaseVersion: "a".repeat(64) },
      classification: { ...input.scopes[0]!.classification, kind: "wordbook", exam: null, day: 1 },
      rows: rows.map(r => ({ sourceRow: r.source_row, rowHash: r.hash, resources: { entryHash: r.hash, linkRecordHash: "a".repeat(64), selected: {} } })),
    }];
    const text = await approve(input);
    await db.query("select public.import_vocabulary_library_v1($1)", [text]);
    const repeat = await db.query("select public.import_vocabulary_library_v1($1)", [text]); expect(repeat.rows).toHaveLength(1);
    await admin(); const day = (await list()).scopes.find(s => s.source.datasetId === d)!;
    expect(day.source).toMatchObject({ kind: "legacy_vocab", releaseId: null }); expect(day.classification.day).toBe(1);
    const t = await save({ action: "create", requestId: randomUUID(), metadata: { ...meta, title: "가짜 DAY 선택" }, recipe: { ...recipe([]), scopes: [{ id: day.id, version: day.version }] } });
    expect(t.versions[0]!.includedKeys).toHaveLength(4);
    await db.exec("reset role");
    expect((await db.query("select private.vocabulary_library_catalog_available_v1($1,'exam_use') allowed", [d])).rows[0]).toEqual({ allowed: false });
    await db.query("insert into public.vocab_dataset_catalog(dataset_id,display_name,catalog_group,material_kind,grade_code,is_assignable) values($1,'가짜 DAY','high','wordbook',null,false)", [d]);
    await admin(); expect((await list()).scopes.find(s => s.id === day.id)!.availability).toBe("retired");
    await expect(save({ action: "create", requestId: randomUUID(), metadata: meta, recipe: { ...recipe([]), scopes: [{ id: day.id, version: day.version }] } })).rejects.toThrow("library_scope_changed");
    await service(); await expect(db.query("select public.import_vocabulary_library_v1($1)", [text])).rejects.toThrow("library_source_unavailable");
    await db.exec("reset role"); await db.query("delete from public.vocab_dataset_catalog where dataset_id=$1", [d]);
    await admin(); expect((await list()).scopes.find(s => s.id === day.id)!.availability).toBe("available");
  });
  it("blocks changed source data and retirement for new saves while historical versions remain readable", async () => {
    await db.exec("reset role");
    await db.query("update public.vocab_datasets set is_active=false where id=$1", [bundle.scopes[0]!.source.datasetId]);
    await admin();
    const states = (await list()).scopes;
    expect(states.filter(s => s.source.datasetId === bundle.scopes[0]!.source.datasetId).every(s => s.availability === "retired")).toBe(true);
    expect(states.find(s => s.classification.day === 1)?.availability).toBe("available");
    await expect(save({ action: "create", requestId: randomUUID(), metadata: meta, recipe: recipe() })).rejects.toThrow("library_scope_changed");
    expect((await list()).templates.find(t => t.id === saved.id)!.versions).toEqual(saved.versions);
  });
  it("does not let a learner or service reader access administrator lists/commands/private source snapshots", async () => {
    await db.exec("reset role; set role authenticated; select set_config('request.jwt.claim.sub','',false);");
    await expect(db.query("select public.list_vocabulary_library_v1()")).rejects.toThrow("admin_required");
    await expect(save({ action: "create", requestId: randomUUID(), metadata: meta, recipe: recipe() })).rejects.toThrow("admin_required");
    await expect(db.query("select * from private.vocabulary_library_versions")).rejects.toThrow(/permission denied/);
    await service(); await expect(db.query("select public.list_vocabulary_library_v1()")).rejects.toThrow(/permission denied/);
  });

  const managementProject = "wojxpruvbjzbhrpmsbuy";
  const managementApproval = "fake-management-approval";
  let managed: LibraryTemplate;
  let managementCommand: { action: string; requestId: string; metadata: typeof meta; recipe: ReturnType<typeof recipe> };
  async function management() {
    await db.exec("reset role; select set_config('request.jwt.claim.sub','',false),set_config('request.jwt.claim.role','',false),set_config('request.jwt.claims','{}',false),set_config('request.headers','{}',false);");
  }
  async function managedCreate(input: unknown, key = "fake-initial-template", project = managementProject) {
    const r = await db.query<{ result: unknown }>("select private.create_vocabulary_library_template_management_v1($1,$2,$3,$4::jsonb) result", [project, managementApproval, key, JSON.stringify(input)]);
    return libraryCommandResultSchema.parse(r.rows[0]!.result).template;
  }
  async function approveTemplate(input: unknown, key: string, project = managementProject) {
    await management();
    await db.query(`insert into private.vocabulary_library_template_approvals(project_ref,approval_id,template_key,command_sha256)
      values($1,$2,$3,private.reviewed_exam_sha256_v1(jsonb_build_array($1::text,$2::text,$3::text,$4::jsonb)))`, [project, managementApproval, key, JSON.stringify(input)]);
    return input;
  }
  it("imports through the actual database owner without HTTP claims, preserving project/file/row checks", async () => {
    await management();
    await db.query("update public.vocab_datasets set is_active=true where id=$1", [bundle.scopes[0]!.source.datasetId]);
    const identity = await db.query("select current_user,session_user,auth.uid() uid,auth.role() role");
    expect(identity.rows[0]).toEqual({ current_user: "postgres", session_user: "postgres", uid: null, role: null });
    const input = structuredClone(bundle); input.scopes.forEach(s => { s.key = `management-${s.key}`; });
    const text = await approve(input); await management();
    const invoke = (body = text, project = managementProject) => db.query("select private.import_vocabulary_library_management_v1($1,$2) result", [body, project]);
    await expect(invoke(text, "xdxhswjgksukjmpbzqgz")).rejects.toThrow("library_import_not_approved");
    await expect(invoke(`${text} `)).rejects.toThrow("library_import_not_approved");
    const altered = structuredClone(input); altered.scopes[0]!.rows[0]!.rowHash = "f".repeat(64);
    const alteredText = await approve(altered); await management();
    await expect(invoke(alteredText)).rejects.toThrow("library_row_or_reference_changed");
    expect((await db.query("select id from private.vocabulary_library_scopes where scope_key like 'management-%'")).rows).toHaveLength(0);
    const first = await invoke(); expect((await invoke()).rows).toEqual(first.rows);
    const states = await db.query("select r.state,count(*)::integer n from private.vocabulary_library_scope_rows r join private.vocabulary_library_scopes s on s.id=r.scope_id where s.scope_key like 'management-%' group by r.state order by r.state");
    expect(states.rows).toEqual([{ state: "excluded", n: 1 }, { state: "held", n: 1 }, { state: "included", n: 5 }]);
    await expect(db.query("select public.import_vocabulary_library_v1($1)", [text])).rejects.toThrow("service_role_required");
    await service(); await expect(db.query("select public.import_vocabulary_library_v1($1)", [text])).rejects.toThrow();
  });
  it("keeps management and shared import functions inaccessible to application roles", async () => {
    await management();
    const grants = await db.query<{ role: string; name: string; allowed: boolean }>(`select r.role,p.proname name,has_function_privilege(r.role,p.oid,'EXECUTE') allowed
      from pg_proc p join pg_namespace n on n.oid=p.pronamespace cross join (values('anon'),('authenticated'),('service_role')) r(role)
      where n.nspname='private' and p.proname in('import_vocabulary_library_core_v1','import_vocabulary_library_management_v1','create_vocabulary_library_template_management_v1')`);
    expect(grants.rows).toHaveLength(9); expect(grants.rows.every(r => !r.allowed)).toBe(true);
    for (const role of ["anon", "authenticated", "service_role"]) {
      await db.exec(`reset role; set role ${role};`);
      await expect(db.query("select private.import_vocabulary_library_management_v1('{}',$1)", [managementProject])).rejects.toThrow(/permission denied/);
      await expect(managedCreate({})).rejects.toThrow(/permission denied/);
      await expect(db.query("select * from private.vocabulary_library_management_requests")).rejects.toThrow(/permission denied/);
    }
  });
  it("records management-created templates honestly and returns the original result on retries", async () => {
    await management();
    managementCommand = { action: "create", requestId: randomUUID(), metadata: { ...meta, title: "관리 등록한 가짜 틀" }, recipe: recipe() };
    await expect(managedCreate(managementCommand)).rejects.toThrow("library_template_not_approved");
    await approveTemplate(managementCommand, "fake-initial-template");
    await expect(managedCreate({ ...managementCommand, metadata: { ...meta, title: "승인과 다른 이름" } })).rejects.toThrow("library_template_not_approved");
    await expect(managedCreate({ ...managementCommand, recipe: { ...recipe(), scopes: [...recipe().scopes].reverse() } })).rejects.toThrow("library_template_not_approved");
    await expect(managedCreate(managementCommand, "unapproved-key")).rejects.toThrow("library_template_not_approved");
    await expect(db.query("select private.create_vocabulary_library_template_management_v1($1,'unknown-approval',$2,$3::jsonb)", [managementProject, "fake-initial-template", JSON.stringify(managementCommand)])).rejects.toThrow("library_template_not_approved");
    managed = await managedCreate(managementCommand);
    expect(managed.versions[0]).toMatchObject({ number: 1, sourceCount: 6 });
    expect(managed.versions[0]!.includedKeys).toHaveLength(4);
    expect(await managedCreate(managementCommand)).toEqual(managed);
    await expect(managedCreate({ ...managementCommand, metadata: { ...meta, title: "다른 요청" } })).rejects.toThrow("library_request_reused");
    await expect(managedCreate({ ...managementCommand, requestId: randomUUID() })).rejects.toThrow("library_template_not_approved");
    await expect(managedCreate(managementCommand, "unapproved-key")).rejects.toThrow("library_request_reused");
    const authors = await db.query(`select t.created_by template_author,v.created_by version_author,t.management_request_id request_id,
      v.management_request_id version_request,r.executed_by,r.session_role,(r.command->>'requestId')::uuid command_id
      from private.vocabulary_library_templates t join private.vocabulary_library_versions v on v.template_id=t.id
      join private.vocabulary_library_management_requests r on r.id=t.management_request_id where t.id=$1`, [managed.id]);
    expect(authors.rows[0]).toEqual({ template_author: null, version_author: null, request_id: managementCommand.requestId,
      version_request: managementCommand.requestId, executed_by: "postgres", session_role: "postgres", command_id: managementCommand.requestId });
    await expect(db.query("update private.vocabulary_library_management_requests set template_key='changed' where id=$1", [managementCommand.requestId])).rejects.toThrow("immutable");
    await expect(db.query("delete from private.vocabulary_library_management_results where request_id=$1", [managementCommand.requestId])).rejects.toThrow("immutable");
    await expect(db.query("update private.vocabulary_library_templates set created_by=$1,management_request_id=null where id=$2", [ids.admin, managed.id])).rejects.toThrow("library_template_author_immutable");
    await expect(db.query("insert into private.vocabulary_library_templates(metadata) values($1::jsonb)", [JSON.stringify(meta)])).rejects.toThrow("vocabulary_library_template_author");
  });
  it("rejects unsupported management actions, wrong environments and invalid recipes without partial receipts", async () => {
    const counts = () => db.query("select (select count(*)::integer from private.vocabulary_library_templates) templates,(select count(*)::integer from private.vocabulary_library_versions) versions,(select count(*)::integer from private.vocabulary_library_management_requests) requests,(select count(*)::integer from private.vocabulary_library_management_results) results");
    const before = await counts();
    const command = { ...managementCommand, requestId: randomUUID() };
    await expect(managedCreate({ ...command, action: "metadata" }, "invalid-action")).rejects.toThrow("invalid_library_management_create");
    await expect(managedCreate(command, "wrong-project", "xdxhswjgksukjmpbzqgz")).rejects.toThrow("management_project_not_approved");
    await db.exec("insert into private.vocabulary_library_import_approvals(target_project_ref,file_sha256,content_sha256,scope_count,approval_id) values('xdxhswjgksukjmpbzqgz',repeat('9',64),repeat('8',64),1,'fake-other-project')");
    await approveTemplate(command, "wrong-scope-project", "xdxhswjgksukjmpbzqgz");
    await expect(managedCreate(command, "wrong-scope-project", "xdxhswjgksukjmpbzqgz")).rejects.toThrow("management_scope_project_mismatch");
    await expect(managedCreate(await approveTemplate({ ...command, recipe: { ...recipe(), excludedOccurrenceKeys: ["f".repeat(64)] } }, "invalid-recipe"), "invalid-recipe")).rejects.toThrow("library_exclusion_outside_scope");
    await expect(managedCreate(await approveTemplate({ ...command, metadata: { ...meta, tags: ["x", "x"] } }, "invalid-metadata"), "invalid-metadata")).rejects.toThrow("invalid_library_tags");
    expect((await counts()).rows).toEqual(before.rows);
    const empty = await managedCreate(await approveTemplate({ ...command, recipe: { ...recipe([]), scopeStatus: "unconfirmed" } }, "empty-confirmation-pending"), "empty-confirmation-pending");
    expect(empty.versions[0]).toMatchObject({ sourceCount: 0, includedKeys: [], recipe: { scopeStatus: "unconfirmed" } });
  });
  it("reassembles exact transport fragments only after every chunk and original hash match", async () => {
    const input = structuredClone(bundle); input.scopes.forEach(s => { s.key = `transfer-${s.key}`; });
    const raw = await approve(input); await management();
    const hash = createHash("sha256").update(raw).digest("hex");
    const cut = Math.floor(raw.length / 2), first = raw.slice(0, cut), second = raw.slice(cut);
    const stage = (index: number, text: string) => db.query("select private.stage_vocabulary_library_import_chunk_v1($1,$2,$3,2,$4)", [managementProject, hash, index, text]);
    const finish = () => db.query<{ result: { scopes: unknown[] } }>("select private.finish_vocabulary_library_import_chunks_v1($1,$2) result", [managementProject, hash]);
    await stage(2, second); await stage(2, second);
    await expect(stage(2, `${second} `)).rejects.toThrow("library_transfer_chunk_changed");
    await expect(finish()).rejects.toThrow("library_transfer_incomplete");
    await stage(1, `${first} `);
    await expect(finish()).rejects.toThrow("library_transfer_hash_mismatch");
    expect((await db.query("select id from private.vocabulary_library_scopes where scope_key like 'transfer-%'")).rows).toHaveLength(0);
    await db.query("delete from private.vocabulary_library_import_chunks where file_sha256=$1 and chunk_index=1", [hash]);
    await stage(1, first);
    expect((await finish()).rows[0]!.result.scopes).toHaveLength(3);
    expect((await db.query("select * from private.vocabulary_library_import_chunks where file_sha256=$1", [hash])).rows).toHaveLength(0);
    await stage(1, first); await stage(2, second); await finish();
    expect((await db.query("select id from private.vocabulary_library_scopes where scope_key like 'transfer-%'")).rows).toHaveLength(3);
    for (const role of ["anon", "authenticated", "service_role"]) {
      await db.exec(`reset role; set role ${role};`);
      await expect(stage(1, first)).rejects.toThrow(/permission denied/);
      await expect(finish()).rejects.toThrow(/permission denied/);
      await expect(db.query("select * from private.vocabulary_library_import_chunks")).rejects.toThrow(/permission denied/);
    }
    await management();
  });
  it("allows normal administrator edits, versions and copies of management-created templates with real user authorship", async () => {
    await admin();
    expect((await list()).templates.find(t => t.id === managed.id)).toEqual(managed);
    const firstVersion = managed.versions[0]!;
    const updated = await save({ action: "metadata", requestId: randomUUID(), templateId: managed.id, expectedRevision: 1, metadata: { ...meta, title: "앱에서 수정", tags: ["기말 대비"] } });
    expect(updated.versions).toEqual(managed.versions);
    const next = await save({ action: "version", requestId: randomUUID(), templateId: managed.id, expectedRevision: 2, expectedContentHash: firstVersion.contentHash, recipe: recipe([0]) });
    expect(next.versions[1]).toEqual(firstVersion);
    const copy = await save({ action: "copy", requestId: randomUUID(), sourceVersionId: firstVersion.id, metadata: { ...meta, title: "앱에서 복사" } });
    expect(copy.versions[0]!.contentHash).toBe(firstVersion.contentHash);
    await management();
    const authors = await db.query<{ created_by: string; management_request_id: null }>("select created_by,management_request_id from private.vocabulary_library_versions where id=any($1::uuid[])", [[next.versions[0]!.id, copy.versions[0]!.id]]);
    expect(authors.rows).toHaveLength(2); expect(authors.rows.every(r => r.created_by === ids.admin && r.management_request_id === null)).toBe(true);
    const copiedAuthor = await db.query("select created_by,management_request_id from private.vocabulary_library_templates where id=$1", [copy.id]);
    expect(copiedAuthor.rows[0]).toEqual({ created_by: ids.admin, management_request_id: null });
    expect(await managedCreate(managementCommand)).toEqual(managed);
  });
});
