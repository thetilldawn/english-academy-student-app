import fs from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

function source(relativePath: string) {
  return fs.readFileSync(path.resolve(relativePath), "utf8");
}

describe("redesign 무중단 배포 migration 계약", () => {
  it("새 writer 설치 단계에서는 현재 운영 writer를 유지한다", () => {
    const predeploy = source(
      "supabase/migrations/20260809090000_fix_mixed_review_dictionary_remap.sql",
    );

    expect(predeploy).not.toContain(
      "revoke all on function public.create_assignment_with_delivery_v4(",
    );
    expect(predeploy).not.toContain(
      "revoke all on function public.create_mixed_review_assignment_v6(",
    );
  });

  it("구 writer 권한 회수는 앱 배포 뒤 전용 migration에서만 수행한다", () => {
    const postdeploy = source(
      "supabase/migrations/20260809110000_retire_legacy_assignment_writers_after_redesign.sql",
    );

    expect(postdeploy).toContain("Apply only after the redesign application");
    expect(postdeploy).toContain(
      "revoke all on function public.create_assignment_with_delivery_v4(",
    );
    expect(postdeploy).toContain(
      "revoke all on function public.create_mixed_review_assignment_v6(",
    );
    expect(postdeploy).not.toContain(
      "revoke all on function public.create_exact_review_assignment_v6(",
    );

    const rollback = source(
      "supabase/rollback/20260809110000_retire_legacy_assignment_writers_after_redesign.sql",
    );
    expect(rollback).toContain(
      "grant execute on function public.create_assignment_with_delivery_v4(",
    );
    expect(rollback).toContain(
      "grant execute on function public.create_mixed_review_assignment_v6(",
    );
    expect(rollback).toContain(
      "grant execute on function public.create_bulk_vocab_assignments_v1(jsonb)",
    );
    expect(rollback).not.toContain(
      "grant execute on function public.create_exact_review_assignment_v4(",
    );
  });

  it("keeps replacement v5 as a v6 compatibility wrapper during rolling deploy", () => {
    const migration = source(
      "supabase/migrations/20260828193000_preserve_assignment_edit_metadata.sql",
    );

    expect(migration).toContain(
      "create or replace function public.replace_student_assignment_v5(",
    );
    expect(migration).toContain(
      "return public.replace_student_assignment_v6(",
    );
    expect(migration).toContain(
      "grant execute on function public.replace_student_assignment_v5(",
    );
  });
});
