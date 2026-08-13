import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

const assetMigration = readFileSync(
  resolve(
    "supabase/migrations/20260813100000_add_vocab_synthetic_audio_assets.sql",
  ),
  "utf8",
);
const importMigration = readFileSync(
  resolve(
    "supabase/migrations/20260813101000_add_synthetic_audio_atomic_import.sql",
  ),
  "utf8",
);

describe("합성 표현 음원 migration", () => {
  it("Webster 표와 분리된 expression 자산 및 불변 Storage 결속을 만든다", () => {
    expect(assetMigration).toContain(
      "create table public.vocab_synthetic_audio_assets",
    );
    expect(assetMigration).toContain("dictionary_id ~ '^expression:");
    expect(assetMigration).toContain(
      "constraint vocab_synthetic_audio_asset_request_contract check",
    );
    expect(assetMigration).toContain(
      "pronunciation/google_cloud_text_to_speech/",
    );
    expect(assetMigration).not.toContain("vocab_entry_pronunciations");
  });

  it("학생 직접 DB 접근을 닫고 서버 역할만 허용한다", () => {
    expect(assetMigration).toContain(
      "alter table public.vocab_synthetic_audio_assets enable row level security;",
    );
    expect(assetMigration).toContain("from public, anon, authenticated;");
    expect(assetMigration).toContain(
      "grant select, insert, update on table public.vocab_synthetic_audio_assets",
    );
    expect(assetMigration).not.toMatch(/create policy/i);
  });

  it("활성 시험 출현을 모두 대조한 뒤 한 RPC로 등록한다", () => {
    expect(importMigration).toContain(
      "create function private.import_vocab_synthetic_audio_package_v1(",
    );
    expect(importMigration).toContain(
      "synthetic_audio_occurrence_binding_mismatch",
    );
    expect(importMigration).toContain(
      "join word_index.app_exam_use_occurrence as exam_occurrence",
    );
    expect(importMigration).toContain(
      "on conflict (dictionary_id, profile_id) do update",
    );
    expect(importMigration).toContain(
      "grant execute on function public.import_vocab_synthetic_audio_package_v1(jsonb)",
    );
  });
});
