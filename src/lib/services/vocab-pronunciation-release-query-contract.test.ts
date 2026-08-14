import { readFile } from "node:fs/promises";
import path from "node:path";

import { describe, expect, it } from "vitest";

describe("active vocabulary pronunciation release query", () => {
  it("filters bindings by active release before PostgREST can truncate history", async () => {
    const source = await readFile(
      path.resolve("src/lib/services/quiz-service.ts"),
      "utf8",
    );
    const start = source.indexOf(
      "async function loadActiveVocabPronunciationReleaseRegistry",
    );
    const end = source.indexOf(
      "async function loadVocabPronunciationDisplayRegistry",
      start,
    );
    const loader = source.slice(start, end);

    expect(start).toBeGreaterThanOrEqual(0);
    expect(end).toBeGreaterThan(start);
    expect(loader.indexOf('.from("vocab_pronunciation_releases_v2")')).toBeLessThan(
      loader.indexOf('.from("vocab_entry_pronunciation_bindings_v2")'),
    );
    expect(loader).toContain('.in("release_id", activeReleaseIds)');
  });
});
