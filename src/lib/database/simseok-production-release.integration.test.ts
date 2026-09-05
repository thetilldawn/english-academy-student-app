import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { PGlite } from "@electric-sql/pglite";
import { pgcrypto } from "@electric-sql/pglite/contrib/pgcrypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { SIMSEOK_PRODUCTION_SETS, validateSimseokProductionPair } from "@/lib/vocab/simseok-production-release-contract";

const migrationsDirectory = path.resolve("supabase/migrations");
const migrationPaths = fs
  .readdirSync(migrationsDirectory)
  .filter((name) => name.endsWith(".sql"))
  .sort()
  .map((name) => path.join(migrationsDirectory, name));

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
      select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid;
    $$;
    create function auth.role()
    returns text language sql stable set search_path = '' as $$
      select nullif(current_setting('request.jwt.claim.role', true), '');
    $$;
    create function auth.jwt()
    returns jsonb language sql stable set search_path = '' as $$
      select coalesce(
        nullif(current_setting('request.jwt.claims', true), ''),
        '{}'
      )::jsonb;
    $$;
  `);
  const rollout: string[] = [];
  for (const migrationPath of migrationPaths) {
    const migration = fs
      .readFileSync(migrationPath, "utf8")
      .replace("create extension if not exists pg_cron;", "");
    if (path.basename(migrationPath) >= "20260820192529") {
      if (path.basename(migrationPath).includes("schedule_read_side_maintenance_jobs")) continue;
      const raw = migration.replace(/\r\n/g,"\n").trim();
      const start = /^((?:\s|--[^\n]*(?:\n|$))*)begin\s*;\s*/i;
      if (start.test(raw) !== /commit\s*;$/i.test(raw)) throw new Error("Unbalanced migration transaction");
      const body = start.test(raw) ? raw.replace(start,"$1").replace(/\s*commit\s*;$/i,"") : raw;
      if (/^\s*(commit|rollback)\s*;/mi.test(body)) throw new Error("Unexpected nested transaction");
      rollout.push(body);
      continue;
    }
    try {
      await database.exec(migration);
    } catch (error) {
      throw new Error(
        `migration failed: ${path.basename(migrationPath)}: ${
          error instanceof Error ? error.message : String(error)
        }`,
        { cause: error },
      );
    }
  }
  await database.exec(`begin;\n${rollout.join("\n\n")}\ncommit;`);
  return database;
}


const sourceRoot = path.resolve("../..", "영어/00_자료투입함/[시안] 제작중/심석고_2학기_단어시험");
const hasSources = fs.existsSync(sourceRoot);
const ids = { admin: "00000000-0000-4000-8000-000000000001" };

describe.sequential("심석고 운영 승인 경계", () => {
  let db: PGlite;
  beforeAll(async () => {
    db = await createFinalSchemaDatabase();
    await db.exec(`
      insert into auth.users(id) values('${ids.admin}');
      insert into public.admin_profiles(user_id,display_name) values('${ids.admin}','Release test');
      select set_config('request.jwt.claim.sub','${ids.admin}',false);
    `);
  }, 30_000);
  afterAll(async () => { await db?.close(); });
  async function role(ref: string, name = "service_role") {
    await db.exec("reset role");
    await db.query("select set_config('request.jwt.claims',$1,false)", [JSON.stringify({ref,role:name})]);
    await db.exec(`set role ${name}`);
  }
  it("예전 자료 상태는 그대로 두고 운영 승인 목록만 정확히 여섯 개 추가한다", async () => {
    const rows = await db.query<{count:number}>("select count(*)::int count from private.simseok_production_approvals_v1");
    expect(rows.rows[0]?.count).toBe(6);
    expect(SIMSEOK_PRODUCTION_SETS.reduce((sum,x)=>sum+x.exam.entryCount,0)).toBe(1509);
    expect(SIMSEOK_PRODUCTION_SETS.map(x=>x.exam.setKey).sort()).toEqual(["g1_adj500","g1_l1","g1_l2","g2_l1","g2_l2","g2_mock"]);
  });
  it("프리뷰에서 운영 가져오기와 활성화를 거부하고 브라우저 역할의 가져오기도 막는다", async () => {
    await role("wojxpruvbjzbhrpmsbuy");
    await expect(db.query("select public.import_approved_simseok_production_pair_v1('{}','{}')")).rejects.toThrow(/production_project_mismatch/);
    await expect(db.query("select public.activate_approved_simseok_production_v1()")).rejects.toThrow(/production_project_mismatch/);
    await role("xdxhswjgksukjmpbzqgz","authenticated");
    await expect(db.query("select public.import_approved_simseok_production_pair_v1('{}','{}')")).rejects.toThrow(/permission denied/);
  });
  it("운영에서 승인되지 않은 패키지와 불완전한 활성화를 거부한다", async () => {
    await role("xdxhswjgksukjmpbzqgz");
    await expect(db.query("select public.import_approved_simseok_production_pair_v1('{}','{}')")).rejects.toThrow(/production_package_not_approved/);
    await expect(db.query("select public.activate_approved_simseok_production_v1()")).rejects.toThrow(/production_release_readback_mismatch/);
  });
  it.skipIf(!hasSources)("검토한 여섯 판본을 1509개·1771행으로 가져오고 승인 후 두 방향을 읽는다", async () => {
    await role("xdxhswjgksukjmpbzqgz");
    for (const set of SIMSEOK_PRODUCTION_SETS) {
      const exam = fs.readFileSync(path.join(sourceRoot,set.sourceVersion,"02_앱전달묶음",set.exam.packagePath),"utf8");
      const question = fs.readFileSync(path.join(sourceRoot,set.sourceVersion,"03_통합문항_앱전달묶음",set.question.packagePath),"utf8");
      validateSimseokProductionPair(set.exam.datasetKey,exam,question);
      await expect(db.query("select public.import_approved_simseok_production_pair_v1($1,$2)",[exam+" ",question])).rejects.toThrow(/production_package_not_approved/);
      const first = await db.query<{result:{status:string}}>("select public.import_approved_simseok_production_pair_v1($1,$2) result",[exam,question]);
      expect(first.rows[0]?.result.status).toBe("staged");
      const second = await db.query<{result:{writes:number,idempotent:boolean}}>("select public.import_approved_simseok_production_pair_v1($1,$2) result",[exam,question]);
      expect(second.rows[0]?.result).toMatchObject({writes:0,idempotent:true});
    }
    await role("xdxhswjgksukjmpbzqgz","authenticated");
    expect((await db.query("select * from public.list_assignment_question_mode_availability_v1()")).rows).toHaveLength(0);
    await role("xdxhswjgksukjmpbzqgz");
    await expect(db.query("select public.activate_approved_simseok_production_v1()")).rejects.toThrow(/production_audio_not_ready/);
    for (const filename of ["simseok-g11-zai7-29-webster-pronunciation.json",
      "simseok-g11-zai7-29-canonical-choice-webster-pronunciation.json"]) {
      const audio=fs.readFileSync(path.join(sourceRoot,"v4_Preview_자이7회29_발음보완",filename),"utf8");
      const inserted = await db.query<{result:{verifiedRows:number}}>("select public.import_approved_simseok_production_audio_v1($1) result",[audio]);
      expect([12,19]).toContain(inserted.rows[0]?.result.verifiedRows);
      const repeated = await db.query<{result:{writes:number}}>("select public.import_approved_simseok_production_audio_v1($1) result",[audio]);
      expect(repeated.rows[0]?.result.writes).toBe(0);
    }
    const active = await db.query<{result:object}>("select public.activate_approved_simseok_production_v1() result");
    expect(active.rows[0]?.result).toMatchObject({sets:6,occurrences:1509,expanded:1771});
    await role("xdxhswjgksukjmpbzqgz","authenticated");
    const available = await db.query<{dataset_id:string,definition_count:number,example_count:number}>("select * from public.list_assignment_question_mode_availability_v1()");
    expect(available.rows).toHaveLength(6);
    expect(available.rows.reduce((sum,x)=>sum+Number(x.definition_count),0)).toBe(840);
    expect(available.rows.reduce((sum,x)=>sum+Number(x.example_count),0)).toBe(926);
    await db.exec("reset role");
    const units=await db.query<{dataset_id:string,unit_ids:string[]}>("select dataset_id,array_agg(id order by sort_index) unit_ids from public.vocab_units group by dataset_id");
    for(const unit of units.rows) {
      await role("xdxhswjgksukjmpbzqgz","authenticated");
      for(const mode of ["canonical_definition_to_headword","canonical_example_to_headword"]) {
        expect((await db.query("select * from public.list_active_canonical_question_preview_v1($1,$2,$3)",[unit.dataset_id,unit.unit_ids,mode])).rows.length).toBeGreaterThan(0);
      }
    }
    await db.exec("reset role");
    const sourceFlags = await db.query<{count:number}>(`select count(*)::int count from word_index.app_canonical_question_preview_release
      where not canonical_approved and not release_allowed and not production_apply_allowed and source_shadow_only`);
    expect(sourceFlags.rows[0]?.count).toBe(6);
  }, 90_000);

  it.skipIf(!hasSources)("운영 영영풀이·예문을 실제 저장하고 재실행과 승인 철회를 검증한다", async () => {
    await db.exec("reset role");
    const dataset=(await db.query<{id:string}>("select id from public.vocab_datasets where dataset_key='simseok-g10-sem2-mid-adjective-500-v1'")).rows[0]!.id;
    const student=randomUUID();
    await db.query("insert into public.students(id,display_name,created_by,current_vocab_dataset_id) values($1,'Release fixture',$2,$3)",[student,ids.admin,dataset]);
    const units=(await db.query<{id:string}>("select id from public.vocab_units where dataset_id=$1 order by sort_index",[dataset])).rows.map(x=>x.id);
    for(const mode of ["canonical_definition_to_headword","canonical_example_to_headword"]) {
      await role("xdxhswjgksukjmpbzqgz","authenticated");
      const candidates=(await db.query<{release_id:string,package_sha256:string,question_item_id:string,question_item_sha256:string,vocab_entry_id:number}>("select * from public.list_active_canonical_question_preview_v1($1,$2,$3) limit 4",[dataset,units,mode])).rows;
      const batch={kind:"canonical_preview",student_id:student,dataset_id:dataset,unit_ids:units,unit_labels:[],title:"Release fixture",question_count:4,quiz_content_mode:mode,
        canonical_release_id:candidates[0]!.release_id,canonical_package_sha256:candidates[0]!.package_sha256,
        time_limit_seconds:60,passing_score:80,retry_enabled:true,retry_passing_score:90,question_order_mode:"ascending",available_from:null,available_until:null,timing_mode:"none",question_time_limit_seconds:null,session_number:1,session_count:1,
        question_targets:candidates.map((x,index)=>({vocab_entry_id:Number(x.vocab_entry_id),base_order_index:index+1,question_item_id:x.question_item_id,question_item_sha256:x.question_item_sha256}))};
      const key=randomUUID(); const hash="a".repeat(64);
      const saved=await db.query("select public.create_bulk_canonical_assignments_preview_v1($1,$2,$3::jsonb) result",[key,hash,JSON.stringify([batch])]);
      expect(saved.rows).toHaveLength(1);
      const repeat=await db.query("select public.get_canonical_assignment_preview_result_v1($1,$2) result",[key,hash]);
      expect(repeat.rows).toEqual(saved.rows);
      await db.exec("reset role");
      await db.query("update private.simseok_production_receipts_v1 set status='staged' where dataset_id=$1",[dataset]);
      await role("xdxhswjgksukjmpbzqgz","authenticated");
      await expect(db.query("select public.create_bulk_canonical_assignments_preview_v1($1,$2,$3::jsonb)",[randomUUID(),hash,JSON.stringify([batch])])).rejects.toThrow(/release_unavailable/);
      await db.exec("reset role");
      await db.query("update private.simseok_production_receipts_v1 set status='active' where dataset_id=$1",[dataset]);
    }
  });

  it.skipIf(!hasSources)("구 일괄 배정은 새 저장기로 생성하고 같은 요청·기존 원본 해시를 안전하게 재조회한다", async () => {
    await db.exec("reset role");
    const dataset=(await db.query<{id:string}>("select id from public.vocab_datasets where dataset_key='simseok-g11-sem2-mid-mock-v1'")).rows[0]!.id;
    const student=randomUUID();
    await db.query("insert into public.students(id,display_name,created_by,current_vocab_dataset_id) values($1,'Legacy release fixture',$2,$3)",[student,ids.admin,dataset]);
    const entries=(await db.query<{id:number,unit_id:string}>("select id,unit_id from public.vocab_entries where dataset_id=$1 order by source_row limit 4",[dataset])).rows;
    const entryIds=entries.map(x=>Number(x.id));
    const batch={kind:"regular",student_id:student,dataset_id:dataset,unit_ids:[entries[0]!.unit_id],unit_labels:["자이 7회 29번"],title:"Legacy release fixture",question_count:4,english_to_korean_ratio:100,
      time_limit_seconds:60,passing_score:80,question_order_mode:"ascending",available_from:null,available_until:null,timing_mode:"none",question_time_limit_seconds:null,session_number:1,session_count:1,
      questions:entries.map((x,index)=>({vocab_entry_id:Number(x.id),base_order_index:index+1,direction:"english_to_korean",choice_vocab_entry_ids:entryIds}))};
    const key=randomUUID();const hash="b".repeat(64);const json=JSON.stringify([batch]);
    await role("xdxhswjgksukjmpbzqgz","authenticated");
    const first=await db.query("select public.create_bulk_vocab_assignments_v5($1,$2,$3::jsonb) result",[key,hash,json]);
    expect((await db.query("select public.create_bulk_vocab_assignments_v5($1,$2,$3::jsonb) result",[key,hash,json])).rows).toEqual(first.rows);
    await expect(db.query("select public.create_bulk_vocab_assignments_v5($1,$2,$3::jsonb)",[key,hash,JSON.stringify([{...batch,title:"Changed"}])])).rejects.toThrow(/idempotency_key_reused/);
    await expect(db.query("select public.create_bulk_vocab_assignments_v5($1,$2,$3::jsonb)",[randomUUID(),hash,JSON.stringify([{...batch,question_count:10001}])])).rejects.toThrow(/bulk_question_count_exceeded/);
    await db.exec("reset role");
    await db.query("update private.bulk_vocab_series_requests set payload_sha256=encode(extensions.digest(convert_to($2::jsonb::text,'UTF8'),'sha256'),'hex') where idempotency_key=$1",[key,json]);
    await role("xdxhswjgksukjmpbzqgz","authenticated");
    expect((await db.query("select public.create_bulk_vocab_assignments_v5($1,$2,$3::jsonb) result",[key,hash,json])).rows).toEqual(first.rows);
    await db.exec("reset role");
    const other=randomUUID();
    await db.query("insert into auth.users(id) values($1)",[other]);
    await db.query("insert into public.admin_profiles(user_id,display_name) values($1,'Other test admin')",[other]);
    await db.query("select set_config('request.jwt.claim.sub',$1,false)",[other]);
    await role("xdxhswjgksukjmpbzqgz","authenticated");
    await expect(db.query("select public.create_bulk_vocab_assignments_v5($1,$2,$3::jsonb)",[key,hash,json])).rejects.toThrow(/idempotency_key_reused/);
    await db.exec("reset role");
    await db.query("select set_config('request.jwt.claim.sub',$1,false)",[ids.admin]);
  });
});
