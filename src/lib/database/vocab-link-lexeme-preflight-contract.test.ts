import { readFile } from "node:fs/promises";
import path from "node:path";

import { describe, expect, it } from "vitest";

describe("VOCA link canonical lexeme preflight", () => {
  it("binds the canonical build and its exact input snapshot before import", async () => {
    const [migration, hardening, importer] = await Promise.all([
      readFile(
        path.resolve(
          "supabase/migrations/20260814232000_add_vocab_link_lexeme_preflight.sql",
        ),
        "utf8",
      ),
      readFile(
        path.resolve(
          "supabase/migrations/20260814232100_harden_vocab_link_lexeme_preflight.sql",
        ),
        "utf8",
      ),
      readFile(path.resolve("scripts/import-vocab-link-package.ts"), "utf8"),
    ]);

    expect(migration).toContain(
      "create function private.preflight_vocab_link_lexeme_batch",
    );
    expect(hardening).toContain("p_input_snapshot_sha256 text");
    expect(hardening).toContain(
      "upper(build.input_snapshot_sha256) = p_input_snapshot_sha256",
    );
    expect(hardening).toContain(
      ") from public, anon, authenticated;",
    );
    expect(importer).toContain(
      "p_input_snapshot_sha256:\n            manifest.wordIndex.inputSnapshotSha256.toUpperCase()",
    );
  });
});
