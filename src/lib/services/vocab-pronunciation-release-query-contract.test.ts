import { readFile } from "node:fs/promises";
import path from "node:path";

import { describe, expect, it } from "vitest";

describe("active vocabulary pronunciation release query", () => {
  it("filters bindings by active release before PostgREST can truncate history", async () => {
    const source = await readFile(
      path.resolve("src/lib/services/quiz/pronunciation-registry.ts"),
      "utf8",
    );
    const start = source.indexOf(
      "export async function loadActiveVocabPronunciationReleaseRegistry",
    );
    const end = source.indexOf(
      "export async function loadVocabPronunciationDisplayRegistry",
      start,
    );
    const loader = source.slice(start, end);

    expect(start).toBeGreaterThanOrEqual(0);
    expect(end).toBeGreaterThan(start);
    expect(loader).toContain('supabase.rpc("list_active_vocab_pronunciation_bindings_v3"');
    expect(loader).toContain('offset += 400');
    expect(loader).not.toContain('.from("vocab_entry_pronunciation_bindings_v2")');
    const migration=await readFile(path.resolve("supabase/migrations/20260908020100_add_reviewed_exam_bank.sql"),"utf8");
    expect(migration).toContain("r.status='active'");
    expect(migration).toContain("from public.assignment_questions aq");
  });
});
