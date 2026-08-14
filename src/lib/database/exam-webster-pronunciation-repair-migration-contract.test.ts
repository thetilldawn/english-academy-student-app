import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

const migration = readFileSync(
  resolve(
    "supabase/migrations/20260814012529_add_exam_webster_pronunciation_repair_import.sql",
  ),
  "utf8",
);

describe("시험 Webster 동일발음 복구 migration", () => {
  it("active release occurrence와 vocab 원행을 모두 대조한다", () => {
    expect(migration).toContain(
      "create function private.import_exam_webster_pronunciation_repair_v1(",
    );
    expect(migration).toContain("and release.status = 'active'");
    expect(migration).toContain("and occurrence.occurrence_id = input.occurrence_id");
    expect(migration).toContain("and occurrence.dictionary_id = input.dictionary_id");
    expect(migration).toContain("and entry.row_sha256 = input.entry_row_sha256");
    expect(migration).toContain(
      "and entry.headword_normalized = input.headword_normalized",
    );
    expect(migration).toContain(
      "jsonb_typeof(p_package) is distinct from 'object'",
    );
  });

  it("28개 표제어·29회 출현과 선택 Webster 변형을 검증한다", () => {
    expect(migration).toContain("or v_dictionary_count <> 28");
    expect(migration).toContain("or v_occurrence_count <> 29");
    expect(migration).toContain("exam_webster_repair_soil_count_mismatch");
    expect(migration).toContain(
      "private.vocab_pronunciation_selection_matches_v1(",
    );
    expect(migration).toContain(
      "and variant.pos is not distinct from input.selected_pos",
    );
    expect(migration).toContain("exam_webster_repair_existing_row_conflict");
  });

  it("삭제 없이 service role만 실행할 수 있다", () => {
    expect(migration).not.toMatch(/delete from public\.vocab_entry_pronunciations/i);
    expect(migration).toContain(
      "grant execute on function\n  public.import_exam_webster_pronunciation_repair_v1(jsonb)\n  to service_role",
    );
    expect(migration).not.toMatch(/grant execute[\s\S]+to (?:anon|authenticated)/i);
  });
});
