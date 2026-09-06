import fs from "node:fs";
import path from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { pgcrypto } from "@electric-sql/pglite/contrib/pgcrypto";

const migrationsDirectory = path.resolve("supabase/migrations");
const migrationPaths = fs
  .readdirSync(migrationsDirectory)
  .filter((name) => name.endsWith(".sql"))
  .sort()
  .map((name) => path.join(migrationsDirectory, name));

export async function createFinalSchemaDatabase() {
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
