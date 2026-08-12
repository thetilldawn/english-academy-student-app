import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

const migration = readFileSync(
  resolve(
    "supabase/migrations/20260812130000_add_vocab_entry_pronunciations.sql",
  ),
  "utf8",
);
const atomicImportMigration = readFileSync(
  resolve(
    "supabase/migrations/20260812131000_add_voca_pronunciation_atomic_import.sql",
  ),
  "utf8",
);

describe("VOCA 발음 연결표 migration", () => {
  it("Webster raw 선택값과 전체 변이를 분리해 보존한다", () => {
    expect(migration).toContain(
      "create table public.vocab_entry_pronunciations",
    );
    expect(migration).toContain("selected_variant_id text");
    expect(migration).toContain("variants jsonb not null");
    expect(migration).toContain("raw_provenance jsonb not null");
    expect(migration).toContain(
      "private.vocab_pronunciation_selection_matches_v1(",
    );
  });

  it("재생 가능·API 보충 필요 상태 조합을 DB에서 검증한다", () => {
    expect(migration).toContain(
      "status in ('raw_first_variant_unreviewed', 'api_lookup_required')",
    );
    expect(migration).toContain(
      "constraint vocab_entry_pronunciations_playback_contract check",
    );
    expect(migration).toContain("and listening_enabled");
    expect(migration).toContain("and not listening_enabled");
  });

  it("학생과 브라우저 관리자 접근을 닫고 서버 역할만 사용한다", () => {
    expect(migration).toContain(
      "alter table public.vocab_entry_pronunciations enable row level security;",
    );
    expect(migration).toContain(
      "from public, anon, authenticated;",
    );
    expect(migration).toContain(
      "grant select, insert, update on table public.vocab_entry_pronunciations",
    );
    expect(migration).toContain("to service_role;");
    expect(migration).not.toMatch(/create policy/i);
    expect(migration).toContain(
      "grant execute on function private.vocab_pronunciation_selection_matches_v1(",
    );
  });

  it("3,001행을 한 트랜잭션에서 기존 VOCA 행과 결속해 저장한다", () => {
    expect(atomicImportMigration).toContain(
      "create function private.import_voca_pronunciation_package_v1(",
    );
    expect(atomicImportMigration).toContain(
      "if v_input_count <> 3001 then",
    );
    expect(atomicImportMigration).toContain(
      "voca_pronunciation_entry_binding_mismatch",
    );
    expect(atomicImportMigration).toContain(
      "on conflict (vocab_entry_id) do update set",
    );
    expect(atomicImportMigration).toContain(
      "grant execute on function public.import_voca_pronunciation_package_v1(jsonb)",
    );
  });
});
