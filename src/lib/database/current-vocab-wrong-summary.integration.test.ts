import fs from "node:fs";
import path from "node:path";

import { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const migration = fs.readFileSync(
  path.resolve(
    "supabase/migrations/20260730233000_list_current_vocab_wrong_summaries.sql",
  ),
  "utf8",
);

const currentDataset = "10000000-0000-4000-8000-000000000001";
const oldDataset = "10000000-0000-4000-8000-000000000002";
const canonicalWord = "20000000-0000-4000-8000-000000000001";

async function expectPostgresError(
  operation: Promise<unknown>,
  code: string,
) {
  try {
    await operation;
    throw new Error("expected PostgreSQL operation to fail");
  } catch (error) {
    expect(error).toMatchObject({ code });
  }
}

describe.sequential("current vocabulary wrong summary RPC", () => {
  let database: PGlite;

  beforeAll(async () => {
    database = new PGlite();
    await database.exec(`
      create role anon nologin;
      create role authenticated nologin;

      create table public.students (
        id uuid primary key,
        status text not null,
        current_vocab_dataset_id uuid
      );
      create table public.student_vocab_wrong_events (
        student_id uuid not null,
        dataset_id uuid not null,
        vocab_entry_id bigint not null,
        canonical_lexeme_id_snapshot uuid
      );

      alter table public.students enable row level security;
      alter table public.student_vocab_wrong_events
        enable row level security;
      create policy authenticated_students
        on public.students
        for select
        to authenticated
        using (true);
      create policy authenticated_wrong_events
        on public.student_vocab_wrong_events
        for select
        to authenticated
        using (true);
      grant select on public.students to authenticated;
      grant select on public.student_vocab_wrong_events
        to authenticated;

      insert into public.students (
        id,
        status,
        current_vocab_dataset_id
      )
      select
        (
          '00000000-0000-4000-8000-'
          || lpad(student_number::text, 12, '0')
        )::uuid,
        'active',
        '${currentDataset}'::uuid
      from generate_series(1, 501) as student_number;

      insert into public.student_vocab_wrong_events (
        student_id,
        dataset_id,
        vocab_entry_id,
        canonical_lexeme_id_snapshot
      )
      values
        (
          '00000000-0000-4000-8000-000000000001',
          '${currentDataset}',
          100,
          '${canonicalWord}'
        ),
        (
          '00000000-0000-4000-8000-000000000001',
          '${currentDataset}',
          101,
          '${canonicalWord}'
        );

      insert into public.student_vocab_wrong_events (
        student_id,
        dataset_id,
        vocab_entry_id,
        canonical_lexeme_id_snapshot
      )
      select
        '00000000-0000-4000-8000-000000000001'::uuid,
        '${currentDataset}'::uuid,
        word_number,
        null
      from generate_series(2, 8) as word_number
      cross join lateral generate_series(1, 2) as occurrence_number;

      insert into public.student_vocab_wrong_events (
        student_id,
        dataset_id,
        vocab_entry_id,
        canonical_lexeme_id_snapshot
      )
      select
        '00000000-0000-4000-8000-000000000001'::uuid,
        '${currentDataset}'::uuid,
        word_number,
        null
      from generate_series(9, 17) as word_number;

      insert into public.student_vocab_wrong_events (
        student_id,
        dataset_id,
        vocab_entry_id,
        canonical_lexeme_id_snapshot
      )
      values (
        '00000000-0000-4000-8000-000000000001',
        '${oldDataset}',
        999,
        null
      );
    `);
    await database.exec(migration);
  }, 20_000);

  afterAll(async () => {
    await database.close();
  });

  it("returns actual current-book history even when no review queue exists", async () => {
    await database.exec("set role authenticated;");
    const summary = await database.query<{
      wrong_word_count: number;
      repeated_wrong_word_count: number;
    }>(`
      select wrong_word_count, repeated_wrong_word_count
      from public.list_student_current_vocab_wrong_summaries(
        null,
        500
      )
      where student_id =
        '00000000-0000-4000-8000-000000000001';
    `);
    await database.exec("reset role;");

    expect(summary.rows).toEqual([
      {
        wrong_word_count: 17,
        repeated_wrong_word_count: 8,
      },
    ]);
  });

  it("pages 501 students without skipping zero-history rows", async () => {
    await database.exec("set role authenticated;");
    const firstPage = await database.query<{ student_id: string }>(`
      select student_id
      from public.list_student_current_vocab_wrong_summaries(
        null,
        500
      );
    `);
    const cursor = firstPage.rows.at(-1)?.student_id;
    expect(cursor).toBeTruthy();
    const secondPage = await database.query<{ student_id: string }>(`
      select student_id
      from public.list_student_current_vocab_wrong_summaries(
        '${cursor}',
        500
      );
    `);
    await database.exec("reset role;");

    expect(firstPage.rows).toHaveLength(500);
    expect(secondPage.rows).toHaveLength(1);
    expect(
      new Set(
        [...firstPage.rows, ...secondPage.rows].map(
          (row) => row.student_id,
        ),
      ).size,
    ).toBe(501);
  });

  it("rejects anonymous callers and invalid page limits", async () => {
    await database.exec("set role anon;");
    await expectPostgresError(
      database.query(
        "select * from public.list_student_current_vocab_wrong_summaries();",
      ),
      "42501",
    );
    await database.exec("reset role; set role authenticated;");
    await expectPostgresError(
      database.query(
        "select * from public.list_student_current_vocab_wrong_summaries(null, 0);",
      ),
      "22023",
    );
    await database.exec("reset role;");
  });
});
