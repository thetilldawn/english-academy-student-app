import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

const migration = readFileSync(
  resolve(
    "supabase/migrations/20260813204000_add_approved_korean_pronunciation_atomic_import.sql",
  ),
  "utf8",
);

describe("approved Korean pronunciation atomic import migration", () => {
  it("실제 합성 음원과 두 독립 검토가 맞아야 한 묶음으로 등록한다", () => {
    expect(migration).toContain(
      "create function private.import_approved_korean_pronunciation_package_v1(",
    );
    expect(migration).toContain(
      "review_method' is distinct from\n      'independent_double_review_exact_audio'",
    );
    expect(migration).toContain(
      "jsonb_typeof(p_package -> 'items') is distinct from 'array'",
    );
    expect(migration).toContain("jsonb_array_length(item.source_review_run_ids) <> 2");
    expect(migration).toContain("count(distinct review.value) <> 2");
    expect(migration).toContain(
      "left join public.vocab_synthetic_audio_assets as asset",
    );
    expect(migration).toContain("asset.speech_text is distinct from item.headword");
    expect(migration).toContain(
      "asset.audio_sha256 is distinct from item.source_content_sha256",
    );
    expect(migration).toContain("asset.playback_enabled is not true");
    expect(migration).toContain(
      "private.valid_korean_pronunciation_segments_v1(",
    );
  });

  it("다른 내용을 덮어쓰지 않고 같은 묶음 재실행만 허용한다", () => {
    expect(migration).toContain(
      "approved_korean_pronunciation_identity_mismatch",
    );
    expect(migration).toContain(
      "on conflict (dictionary_id, pronunciation_variant_id) do nothing",
    );
    expect(migration).toContain(
      "approved_korean_pronunciation_import_count_mismatch",
    );
  });

  it("학생 계정에서는 실행할 수 없고 서버 역할만 실행한다", () => {
    expect(migration).toContain(
      "revoke all on function\n  public.import_approved_korean_pronunciation_package_v1(jsonb)\n  from public, anon, authenticated",
    );
    expect(migration).toContain(
      "grant execute on function\n  public.import_approved_korean_pronunciation_package_v1(jsonb)\n  to service_role",
    );
  });
});
