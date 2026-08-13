import { readFile } from "node:fs/promises";
import path from "node:path";

import { PGlite } from "@electric-sql/pglite";
import { describe, expect, it } from "vitest";

const migrationPath = path.resolve(
  "supabase/migrations/20260813203000_add_approved_korean_pronunciation_segments.sql",
);
const validationFixMigrationPath = path.resolve(
  "supabase/migrations/20260813203200_fix_approved_korean_pronunciation_validation.sql",
);
const multiwordStressMigrationPath = path.resolve(
  "supabase/migrations/20260813203300_allow_multiword_primary_stress.sql",
);

describe("approved Korean pronunciation data", () => {
  it("accepts and stores the four reviewed segment records", async () => {
    const database = new PGlite();
    await database.exec(`
      create role anon nologin;
      create role authenticated nologin;
      create role service_role nologin;
      create schema private;
    `);
    const migration = await readFile(migrationPath, "utf8");
    const validationFixMigration = await readFile(
      validationFixMigrationPath,
      "utf8",
    );
    const multiwordStressMigration = await readFile(
      multiwordStressMigrationPath,
      "utf8",
    );
    const seedMarker = "insert into public.vocab_approved_korean_pronunciations";
    const seedOffset = migration.indexOf(seedMarker);
    await database.exec(migration.slice(0, seedOffset));
    await database.exec(validationFixMigration);
    await database.exec(multiwordStressMigration);
    const validation = await database.query<{
      combined: string;
      invalid_count: number;
      primary_count: number;
      valid: boolean;
    }>(`
      with input as (
        select '[{"text":"이","stress":"none"},{"text":"네","stress":"primary"},{"text":"버","stress":"none"},{"text":"터","stress":"none"},{"text":"벌","stress":"none"}]'::jsonb as segments
      )
      select
        private.valid_korean_pronunciation_segments_v1(
          '이네버터벌',
          input.segments
        ) as valid,
        (
          select string_agg(segment.value ->> 'text', '' order by segment.ordinality)
          from jsonb_array_elements(input.segments)
            with ordinality as segment(value, ordinality)
        ) as combined,
        (
          select count(*)::integer
          from jsonb_array_elements(input.segments) as segment(value)
          where segment.value ->> 'stress' = 'primary'
        ) as primary_count,
        (
          select count(*)::integer
          from jsonb_array_elements(input.segments) as segment(value)
          where jsonb_typeof(segment.value) <> 'object'
            or coalesce(segment.value ->> 'text', '') = ''
            or segment.value ->> 'stress' not in ('none', 'secondary', 'primary')
        ) as invalid_count
      from input
    `);
    expect(validation.rows).toEqual([
      {
        combined: "이네버터벌",
        invalid_count: 0,
        primary_count: 1,
        valid: true,
      },
    ]);
    const missingStress = await database.query<{ valid: boolean }>(`
      select private.valid_korean_pronunciation_segments_v1(
        '테스트',
        '[{"text":"테","stress":"primary"},{"text":"스트"}]'::jsonb
      ) as valid
    `);
    expect(missingStress.rows).toEqual([{ valid: false }]);
    const multiwordPrimary = await database.query<{ valid: boolean }>(`
      select private.valid_korean_pronunciation_segments_v1(
        '어플라이 포어',
        '[{"text":"어플","stress":"none"},{"text":"라이 ","stress":"primary"},{"text":"포어","stress":"primary"}]'::jsonb
      ) as valid
    `);
    expect(multiwordPrimary.rows).toEqual([{ valid: true }]);
    await database.exec(migration.slice(seedOffset));

    const result = await database.query<{
      dictionary_id: string;
      display_pronunciation_ko: string;
      segment_count: number;
    }>(`
      select
        dictionary_id,
        display_pronunciation_ko,
        jsonb_array_length(segments)::integer as segment_count
      from public.vocab_approved_korean_pronunciations
      order by dictionary_id
    `);

    expect(result.rows).toEqual([
      {
        dictionary_id: "word:creative",
        display_pronunciation_ko: "크리에이티브",
        segment_count: 3,
      },
      {
        dictionary_id: "word:inevitable",
        display_pronunciation_ko: "이네버터벌",
        segment_count: 5,
      },
      {
        dictionary_id: "word:inspire",
        display_pronunciation_ko: "인스파이어",
        segment_count: 3,
      },
      {
        dictionary_id: "word:loss",
        display_pronunciation_ko: "로스",
        segment_count: 1,
      },
    ]);

    await database.close();
  });
});
