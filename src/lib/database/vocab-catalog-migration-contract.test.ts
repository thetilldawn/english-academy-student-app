import fs from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

const migration = fs.readFileSync(
  path.resolve(
    "supabase/migrations/20260808114249_add_vocab_catalog_projection.sql",
  ),
  "utf8",
);
const readinessFix = fs.readFileSync(
  path.resolve(
    "supabase/migrations/20260808130404_fix_assignable_exam_use_dataset.sql",
  ),
  "utf8",
);

describe("vocabulary catalog migration", () => {
  it("adds dataset and unit projections without replacing source IDs", () => {
    expect(migration).toContain("create table public.vocab_dataset_catalog");
    expect(migration).toContain("references public.vocab_datasets(id)");
    expect(migration).toContain("create table public.vocab_unit_catalog");
    expect(migration).toContain("references public.vocab_units(id)");
    expect(migration).not.toMatch(
      /'[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}'/i,
    );
  });

  it("records the agreed hierarchy and an independent assignable flag", () => {
    for (const group of ["middle", "high", "high_mock", "csat"]) {
      expect(migration).toContain(`'${group}'`);
    }
    expect(migration).toContain("is_assignable boolean not null default true");
    expect(migration).toContain(
      "dataset.dataset_key = 'g12-long-reading-2025-exam-ready-v1'",
    );
  });

  it("exposes the dataset that owns the active exam-use release", () => {
    expect(readinessFix).toContain(
      "when 'g12-long-reading-2025-exam-scope-v1' then true",
    );
    expect(readinessFix).toContain(
      "'g12-long-reading-2025-exam-ready-v1'",
    );
    expect(readinessFix).not.toMatch(
      /'[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}'/i,
    );
  });

  it("enables RLS and exposes read access only to active admins", () => {
    expect(migration).toContain(
      "alter table public.vocab_dataset_catalog enable row level security",
    );
    expect(migration).toContain(
      "alter table public.vocab_unit_catalog enable row level security",
    );
    expect(migration).toContain("to authenticated");
    expect(migration).toContain("private.is_active_admin()");
  });
});
