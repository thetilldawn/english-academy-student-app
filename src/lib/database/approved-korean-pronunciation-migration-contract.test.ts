import { readFile } from "node:fs/promises";
import path from "node:path";

import { describe, expect, it } from "vitest";

const migrationPath = path.resolve(
  "supabase/migrations/20260813203000_add_approved_korean_pronunciation_segments.sql",
);
const policyMigrationPath = path.resolve(
  "supabase/migrations/20260813203100_add_approved_korean_pronunciation_service_policy.sql",
);
const validationFixMigrationPath = path.resolve(
  "supabase/migrations/20260813203200_fix_approved_korean_pronunciation_validation.sql",
);
const multiwordStressMigrationPath = path.resolve(
  "supabase/migrations/20260813203300_allow_multiword_primary_stress.sql",
);

describe("approved Korean pronunciation migration", () => {
  it("stores only reviewed, structurally validated segments behind service-role access", async () => {
    const migration = await readFile(migrationPath, "utf8");
    const policyMigration = await readFile(policyMigrationPath, "utf8");
    const validationFixMigration = await readFile(
      validationFixMigrationPath,
      "utf8",
    );
    const multiwordStressMigration = await readFile(
      multiwordStressMigrationPath,
      "utf8",
    );

    expect(migration).toContain(
      "create table public.vocab_approved_korean_pronunciations",
    );
    expect(migration).toContain(
      "private.valid_korean_pronunciation_segments_v1",
    );
    expect(migration).toContain(
      "primary key (dictionary_id, pronunciation_variant_id)",
    );
    expect(migration).toContain("review_status = 'approved'");
    expect(migration).toContain("enable row level security");
    expect(migration).toContain("from public, anon, authenticated");
    expect(migration).toContain("to service_role");
    expect(migration).toContain("'word:inevitable'");
    expect(migration).toContain("'mw:96341e1884b6474e4bee'");
    expect(policyMigration).toContain(
      "vocab_approved_korean_pronunciations_service_select",
    );
    expect(policyMigration).toContain("to service_role");
    expect(policyMigration).toContain("using (true)");
    expect(validationFixMigration).toContain(
      "coalesce(segment.value ->> 'stress', '') not in",
    );
    expect(multiwordStressMigration).toContain(") >= 1");
  });
});
