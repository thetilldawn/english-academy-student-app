import fs from "node:fs";
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


describe.sequential("saved mock wordbooks", () => {
  let db: PGlite;
  let scopes: Array<{id:string;version:string}>;
  let saved: {datasetId:string};
  const requestId = "00000000-0000-4000-8000-000000005001";
  const sourceIds: string[] = [];
  const registrations: Array<Record<string,unknown>> = [];
  const request = () => ({requestId,title:"가짜 3개년 단어장",scopes});
  const admin = () => db.exec(`reset role; set role authenticated; select set_config('request.jwt.claim.sub','${ids.admin}',false); select set_config('request.jwt.claim.role','authenticated',false);`);
  beforeAll(async()=>{
    db=await createFinalSchemaDatabase();
    await db.exec(`insert into auth.users(id) values('${ids.admin}'); insert into public.admin_profiles(user_id,display_name) values('${ids.admin}','가짜 관리자');`);
    for(const year of [2024,2025,2026]){
      const pack=buildPackage();
      const excluded=buildEntry(5);excluded.include_in_exam=false;excluded.exam_use_status='excluded';excluded.content_hash=computeExamUseEntryContentHash(excluded);
      (pack.entries as unknown[]).push(excluded);
      pack.dataset_key=`fake-mock-${year}`; pack.title=`가짜 ${year}년`;
      pack.package_version=computeExamUsePackageVersion(pack);
      await db.exec("set role service_role; select set_config('request.jwt.claim.role','service_role',false);");
      const result=await db.query<{result:{datasetId:string;releaseId:string}}>("select public.import_app_exam_use_package_v1($1::jsonb) result",[JSON.stringify(pack)]);
      const source=result.rows[0]!.result; sourceIds.push(source.datasetId);
      await db.exec("reset role");
      await db.query("update public.vocab_entries set english_definition='A fake definition',example_en='A fake example.',example_ko='가짜 예문' where dataset_id=$1",[source.datasetId]);
      await db.query("insert into public.vocab_dataset_catalog(dataset_id,display_name,catalog_group,material_kind,grade_code) values($1,$2,'high_mock','wordbook','g12')",[source.datasetId,`가짜${year}`]);
      const unit=await db.query<{id:string}>("select id from public.vocab_units where dataset_id=$1",[source.datasetId]);
      await db.query(`insert into word_index.mock_wordbook_identity_review(source_release_id,source_entry_id,source_row_sha256,reviewed_headword,reviewed_gloss,lexical_pos,sense_id,review_evidence_sha256)
        select $1,id,row_sha256,headword,primary_meaning,'noun','fake-sense-'||source_row,repeat('a',64) from public.vocab_entries where dataset_id=$2 and source_row<4`,[source.releaseId,source.datasetId]);
      await db.exec("set role service_role; select set_config('request.jwt.claim.role','service_role',false);");
      const registration={sourceReleaseId:source.releaseId,sourceUnitId:unit.rows[0]!.id,
        displayName:`${year}년 3월 빈칸 [31번]`,reviewEvidenceSha256:'b'.repeat(64),metadata:{executionYear:year,examMonth:3,examKind:'mock',academicYear:null,agency:'가짜',typeCode:'blank',typeLabel:'빈칸',questionNumbers:[31],sharedPassage:false}};
      registrations.push(registration);
      await db.query("select public.register_mock_wordbook_scopes_v1($1::jsonb)",[JSON.stringify([registration])]);
    }
    await admin();
    const list=await db.query<{result:{scopes:Array<{id:string;version:string}>}}>("select public.list_mock_wordbook_scopes_v1() result");
    scopes=list.rows[0]!.result.scopes.map(({id,version})=>({id,version}));
  },60000);
  afterAll(async()=>{await db?.close();});
  it("three reviewed years are selectable without exposing source answers",async()=>{
    expect(scopes).toHaveLength(3);
    const list=await db.query<{result:unknown}>("select public.list_mock_wordbook_scopes_v1() result");
    expect(JSON.stringify(list.rows[0]!.result)).not.toMatch(/display_gloss|package_json|exam_input/);
  });
  it("saves all occurrences, fixed units, learning fields and lineage with one idempotent result",async()=>{
    const first=await db.query<{result:{datasetId:string}}>("select public.create_mock_wordbook_composition_v1($1::jsonb) result",[JSON.stringify(request())]);
    saved=first.rows[0]!.result;
    const again=await db.query<{result:unknown}>("select public.create_mock_wordbook_composition_v1($1::jsonb) result",[JSON.stringify(request())]);
    expect(again.rows[0]!.result).toEqual(saved);
    const targets=await db.query<{vocab_entry_id:number;identity_key:string}>("select * from public.list_mock_composition_targets_v1($1)",[saved.datasetId]);
    expect(targets.rows).toHaveLength(12); expect(new Set(targets.rows.map(r=>r.identity_key)).size).toBe(6);
    await db.exec('reset role');
    const counts=await db.query<{units:number;entries:number;lineage:number}>(`select (select count(*)::int from public.vocab_units where dataset_id=$1) units,
      (select count(*)::int from public.vocab_entries where dataset_id=$1) entries,(select count(*)::int from word_index.mock_wordbook_lineage l join word_index.mock_wordbook_composition c on c.release_id=l.release_id where c.dataset_id=$1) lineage`,[saved.datasetId]);
    expect(counts.rows[0]).toEqual({units:3,entries:12,lineage:15});
    const copies=await db.query<{fields_match:boolean}>(`select bool_and(e.headword=s.headword and e.primary_meaning=s.primary_meaning and e.meanings=s.meanings
      and e.english_definition=s.english_definition and e.example_en=s.example_en and e.example_ko=s.example_ko
      and e.pronunciation_ko=s.pronunciation_ko and e.source_ref is not distinct from s.source_ref) fields_match
      from word_index.mock_wordbook_lineage l join public.vocab_entries e on e.id=l.vocab_entry_id join public.vocab_entries s on s.id=l.source_entry_id where e.dataset_id=$1`,[saved.datasetId]);
    expect(copies.rows[0]!.fields_match).toBe(true);
    await admin();
  });
  it("retains excluded occurrences without vocabulary or review proofs and keeps unreviewed source rows independent",async()=>{
    const eligible=await db.query("select * from public.list_active_exam_use_eligibility_v2($1)",[saved.datasetId]);expect(eligible.rows).toHaveLength(24);
    await db.exec('reset role');
    const excluded=await db.query(`select l.vocab_entry_id,l.source_entry_id,l.identity_key,l.identity_review_snapshot from word_index.mock_wordbook_lineage l
      join word_index.mock_wordbook_composition c on c.release_id=l.release_id where c.dataset_id=$1 and not l.included`,[saved.datasetId]);
    expect(excluded.rows).toEqual(Array.from({length:3},()=>({vocab_entry_id:null,source_entry_id:null,identity_key:null,identity_review_snapshot:null})));
    const unknown=await db.query<{identity_key:string}>(`select l.identity_key from word_index.mock_wordbook_lineage l join word_index.mock_wordbook_composition c on c.release_id=l.release_id
      where c.dataset_id=$1 and l.included and l.identity_review_snapshot is null`,[saved.datasetId]);
    expect(unknown.rows).toHaveLength(3);expect(new Set(unknown.rows.map(r=>r.identity_key)).size).toBe(3);await admin();
  });
  it("creates a real assignment with fixed source, meaning and pronunciation snapshots and rejects repeated reviewed targets",async()=>{
    await db.exec('reset role');
    await db.query("insert into public.students(id,display_name,status,created_by) values($1,'가짜 배정 학생','active',$2)",[ids.student,ids.admin]);
    const entries=await db.query<{id:number;unit_id:string}>("select id,unit_id from public.vocab_entries where dataset_id=$1 order by source_row",[saved.datasetId]);
    const units=[...new Set(entries.rows.map(e=>e.unit_id))];
    const first=entries.rows.filter(e=>e.unit_id===units[0]);
    const second=entries.rows.filter(e=>e.unit_id===units[1]);
    const questions=(rows:typeof entries.rows)=>rows.map((entry,index)=>({vocab_entry_id:entry.id,base_order_index:index+1,direction:'english_to_korean',
      choice_vocab_entry_ids:entries.rows.filter(e=>e.unit_id===entry.unit_id).map(e=>e.id)}));
    const create=(selectedUnits:string[],rows:typeof entries.rows)=>db.query<{id:string}>(`select public.create_assignment_with_delivery_v7(
      '가짜 조합 배정',$1::uuid,$2::uuid[],4,100::smallint,300,80::smallint,true,80::smallint,
      'fixed'::public.question_order_mode,null,array[$3::uuid],'total',null,$4::jsonb) id`,[saved.datasetId,selectedUnits,ids.student,JSON.stringify(questions(rows))]);
    await admin();
    const created=await create([units[0]!],first);
    await db.exec('reset role');
    const snapshot=await db.query<{question_count:number;identity_count:number;frozen_matches:boolean}>(`select count(*)::int question_count,
      count(distinct q.composition_target_key_snapshot)::int identity_count,
      bool_and(q.composition_target_key_snapshot=l.identity_key and s.release_id=l.release_id and s.release_id<>l.source_release_id
        and q.primary_meaning_snapshot=l.source_entry_snapshot->>'primary_meaning'
        and s.primary_meaning_snapshot=l.source_occurrence_snapshot->>'display_gloss_ko'
        and s.pronunciation_snapshot->>'audioStatus'='raw_attached'
        and s.pronunciation_snapshot->>'audioUrl'=l.source_occurrence_snapshot->>'audio_url'
        and s.pronunciation_snapshot->>'rawResponseSha256'=l.source_occurrence_snapshot->>'raw_response_sha256'
        and jsonb_array_length(s.choice_dictionary_snapshots)=4) frozen_matches
      from public.assignment_questions q join public.assignment_question_exam_use_snapshot s on s.assignment_question_id=q.id
      join word_index.mock_wordbook_lineage l on l.vocab_entry_id=q.vocab_entry_id where q.assignment_id=$1`,[created.rows[0]!.id]);
    expect(snapshot.rows[0]).toEqual({question_count:4,identity_count:4,frozen_matches:true});
    await admin();
    await expect(create(units.slice(0,2),[first[0]!,second[0]!,first[2]!,first[3]!])).rejects.toThrow('assignment_composition_target_once');
    await db.exec('reset role');
    const count=await db.query<{n:number}>("select count(*)::int n from public.assignments where dataset_id=$1",[saved.datasetId]);
    expect(count.rows[0]!.n).toBe(1);await admin();
  });
  it("rejects a different payload with the same id and stale or repeated scopes",async()=>{
    await expect(db.query("select public.create_mock_wordbook_composition_v1($1::jsonb)",[JSON.stringify({...request(),title:'다른 이름'})])).rejects.toThrow('composition_request_conflict');
    await expect(db.query("select public.create_mock_wordbook_composition_v1($1::jsonb)",[JSON.stringify({...request(),requestId:ids.student,scopes:[scopes[0],scopes[0]]})])).rejects.toThrow('invalid_composition_scopes');
    await expect(db.query("select public.create_mock_wordbook_composition_v1($1::jsonb)",[JSON.stringify({...request(),requestId:ids.student,scopes:[{...scopes[0],version:'f'.repeat(64)}]})])).rejects.toThrow('composition_scope_changed');
  });
  it("protects old words and immutable composed content and resolves each source ID",async()=>{
    await db.exec('reset role');
    const entries=await db.query<{id:number}>("select id from public.vocab_entries where dataset_id=$1 order by source_row",[saved.datasetId]);
    await expect(db.query("update public.vocab_entries set primary_meaning='변경' where id=$1",[entries.rows[0]!.id])).rejects.toThrow('mock_composition_content_is_immutable');
    await expect(db.query("update public.vocab_datasets set metadata='{}'::jsonb where id=$1",[saved.datasetId])).rejects.toThrow('mock_composition_content_is_immutable');
    await expect(db.query("update public.vocab_dataset_catalog set grade_code='g11' where dataset_id=$1",[saved.datasetId])).rejects.toThrow('mock_composition_content_is_immutable');
    await expect(db.query("update word_index.app_exam_use_release set package_json='{}'::jsonb where dataset_id=$1",[saved.datasetId])).rejects.toThrow('mock_composition_content_is_immutable');
    await db.query("update public.vocab_datasets set is_active=false where id=$1",[saved.datasetId]);
    await db.query("update public.vocab_datasets set is_active=true where id=$1",[saved.datasetId]);
    await db.exec("set role service_role; select set_config('request.jwt.claim.role','service_role',false)");
    const links=await db.query<{vocab_entry_id:number;source_entry_id:number}>("select * from public.list_mock_composition_lineage_v1($1::bigint[])",[entries.rows.map(r=>r.id)]);
    expect(links.rows).toHaveLength(12); expect(links.rows.every(r=>r.vocab_entry_id!==r.source_entry_id)).toBe(true);
    await db.exec('reset role');
    const original=await db.query<{n:number}>("select count(*)::int n from public.vocab_entries where dataset_id=any($1::uuid[])",[sourceIds]);
    expect(original.rows[0]!.n).toBe(12); await admin();
  });
  it("lists only the latest tag revision and refuses multiple versions of one source scope",async()=>{
    await db.exec("reset role; set role service_role; select set_config('request.jwt.claim.role','service_role',false)");
    await db.query("select public.register_mock_wordbook_scopes_v1($1::jsonb)",[JSON.stringify([{...registrations[0],reviewEvidenceSha256:'c'.repeat(64)}])]);
    await admin();
    const listed=await db.query<{result:{scopes:Array<{id:string;version:string}>}}>("select public.list_mock_wordbook_scopes_v1() result");
    expect(listed.rows[0]!.result.scopes).toHaveLength(3);
    const newScope=listed.rows[0]!.result.scopes.find(s=>!scopes.some(old=>old.id===s.id))!;expect(newScope).toBeDefined();
    const oldScope=scopes.find(s=>!listed.rows[0]!.result.scopes.some(current=>current.id===s.id))!;
    await expect(db.query("select public.create_mock_wordbook_composition_v1($1::jsonb)",[JSON.stringify({...request(),requestId:ids.student,scopes:[oldScope,newScope].map(({id,version})=>({id,version}))})])).rejects.toThrow('invalid_composition_scopes');
    await expect(db.query("select public.create_mock_wordbook_composition_v1($1::jsonb)",[JSON.stringify({...request(),requestId:ids.student,scopes:[oldScope]})])).rejects.toThrow('composition_scope_changed');
    const retry=await db.query<{result:unknown}>("select public.create_mock_wordbook_composition_v1($1::jsonb) result",[JSON.stringify(request())]);expect(retry.rows[0]!.result).toEqual(saved);
  });
  it("rejects non-admin use and keeps raw lineage service-only",async()=>{
    await expect(db.query("select * from public.list_mock_composition_lineage_v1(array[1]::bigint[])")).rejects.toThrow('permission denied');
    await db.exec("select set_config('request.jwt.claim.sub','',false)");
    await expect(db.query("select public.list_mock_wordbook_scopes_v1()")).rejects.toThrow('admin_required');
    await expect(db.query("select public.create_mock_wordbook_composition_v1($1::jsonb)",[JSON.stringify(request())])).rejects.toThrow('admin_required');
    await admin();
  });
});
