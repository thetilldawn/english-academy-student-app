import fs from "node:fs";
import path from "node:path";

import { PGlite } from "@electric-sql/pglite";
import { describe, expect, it } from "vitest";

const migration = fs.readFileSync(
  path.resolve(
    "supabase/migrations/20260730224500_schedule_missed_assignment_finalization.sql",
  ),
  "utf8",
);

describe("missed assignment schedule migration", () => {
  it("uses Supabase Cron to run one bounded database batch each minute", () => {
    expect(migration).toContain(
      "create extension if not exists pg_cron",
    );
    expect(migration).toContain(
      "'english-academy-finalize-missed-assignments'",
    );
    expect(migration).toContain("'* * * * *'");
    expect(migration).toContain(
      "public.finalize_missed_assignments(null, 250)",
    );
    expect(migration).not.toContain("http");
    expect(migration).not.toContain("service_role");
  });

  it("registers the expected job through the pg_cron SQL interface", async () => {
    const database = new PGlite();
    await database.exec(`
      create schema cron;
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
      )
      returns bigint
      language plpgsql
      as $$
      declare
        scheduled_job_id bigint;
      begin
        insert into cron.job (jobname, schedule, command)
        values (p_jobname, p_schedule, p_command)
        on conflict (jobname) do update
        set
          schedule = excluded.schedule,
          command = excluded.command
        returning jobid into scheduled_job_id;
        return scheduled_job_id;
      end;
      $$;
    `);

    const pgliteMigration = migration.replace(
      "create extension if not exists pg_cron;",
      "",
    );
    await database.exec(pgliteMigration);
    await database.exec(pgliteMigration);

    const registered = await database.query<{
      jobname: string;
      schedule: string;
      command: string;
    }>(`
      select jobname, schedule, command
      from cron.job;
    `);
    expect(registered.rows).toEqual([
      {
        jobname: "english-academy-finalize-missed-assignments",
        schedule: "* * * * *",
        command:
          "\n    select public.finalize_missed_assignments(null, 250);\n  ",
      },
    ]);

    await database.close();
  });
});
