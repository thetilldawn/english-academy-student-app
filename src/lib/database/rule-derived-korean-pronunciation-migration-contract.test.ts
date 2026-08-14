import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

const migration = readFileSync(
  resolve(
    "supabase/migrations/20260814094039_add_rule_derived_korean_pronunciations.sql",
  ),
  "utf8",
);
const repairIdentityMigration = readFileSync(
  resolve(
    "supabase/migrations/20260814094628_fix_rule_derived_webster_repair_identity.sql",
  ),
  "utf8",
);

describe("rule-derived Korean pronunciation migration", () => {
  it("사람 승인 표와 분리하고 최종 음원 및 601회 출현을 원자 검증한다", () => {
    expect(migration).toContain(
      "create table public.vocab_rule_derived_korean_pronunciations",
    );
    expect(migration).toContain("derivation_status = 'rule_derived'");
    expect(migration).toContain("engine_version = 'cmudict-hangul-align-v2'");
    expect(migration).toContain("hangul_alignment_only");
    expect(migration).toContain(
      "pronunciation_variant_id ~\n      '^(mw:[0-9a-f]{20}|synthetic:[0-9a-f]{64})$'",
    );
    expect(migration).toContain(
      "count(distinct occurrence.value)",
    );
    expect(migration).toContain(
      "left join word_index.app_exam_use_occurrence as occurrence",
    );
    expect(migration).toContain(
      "left join public.vocab_synthetic_audio_bindings as binding",
    );
    expect(migration).toContain(
      "rule_derived_korean_pronunciation_audio_identity_mismatch",
    );
  });

  it("동일 재실행만 허용하고 학생 계정에는 표와 등록 함수를 공개하지 않는다", () => {
    expect(migration).toContain(
      "rule_derived_korean_pronunciation_identity_conflict",
    );
    expect(migration).toContain(
      "on conflict (dictionary_id, pronunciation_variant_id) do nothing",
    );
    expect(migration).toContain("enable row level security");
    expect(migration).toContain(
      "revoke all on table public.vocab_rule_derived_korean_pronunciations\n  from public, anon, authenticated",
    );
    expect(migration).toContain(
      "grant execute on function\n  public.import_rule_derived_korean_pronunciation_package_v1(jsonb)\n  to service_role",
    );
  });

  it("화면과 같은 순서로 시험 원본, Webster 보완, 합성 음원을 선택한다", () => {
    expect(repairIdentityMigration).toContain(
      "left join public.vocab_entry_pronunciations as repair",
    );
    expect(repairIdentityMigration).toContain(
      "when repair.listening_enabled\n           then repair.selected_variant_id",
    );
    expect(repairIdentityMigration).toContain(
      "repair.raw_provenance -> 0 ->> 'raw_response_sha256'",
    );
    expect(repairIdentityMigration).toContain(
      "else asset.asset_id",
    );
  });
});
