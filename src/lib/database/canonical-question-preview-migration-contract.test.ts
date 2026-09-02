import fs from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

const migration = fs
  .readFileSync(
    path.join(
      process.cwd(),
      "supabase/migrations/20260902090557_add_canonical_question_preview.sql",
    ),
    "utf8",
  )
  .replace(/\r\n/g, "\n");

describe("canonical question Preview migration contract", () => {
  it("keeps raw shadow tables closed to every API role", () => {
    expect(migration).toContain(
      "alter table word_index.app_canonical_question_preview_release enable row level security;",
    );
    expect(migration).toContain(
      "alter table word_index.app_canonical_question_preview_item enable row level security;",
    );
    expect(migration).toContain(
      "revoke all on table word_index.app_canonical_question_preview_release\n  from public, anon, authenticated, service_role;",
    );
    expect(migration).toContain(
      "revoke all on table word_index.app_canonical_question_preview_item\n  from public, anon, authenticated, service_role;",
    );
    expect(migration).toContain(
      "revoke all on table private.bulk_canonical_question_preview_requests\n  from public, anon, authenticated, service_role;",
    );
    expect(migration).not.toMatch(
      /grant\s+(?:select|insert|update|delete|all)[\s\S]*?app_canonical_question_preview_(?:release|item)/i,
    );
  });

  it("locks every public data path to Preview and an active administrator", () => {
    expect(
      migration.match(/private\.request_supabase_project_ref_v1\(\)/g),
    ).toHaveLength(4);
    expect(
      migration.match(/'wojxpruvbjzbhrpmsbuy'/g)?.length,
    ).toBeGreaterThanOrEqual(6);
    expect(migration.match(/security definer/g)).toHaveLength(6);
    expect(migration.match(/set search_path = ''/g)).toHaveLength(6);
    expect(migration.match(/not \(select private\.is_active_admin\(\)\)/g)).toHaveLength(4);
  });

  it("keeps import service-only and browser RPCs authenticated-only", () => {
    expect(migration).toContain(
      "revoke all on function public.import_canonical_question_preview_release_v1(\n  uuid, jsonb, jsonb\n) from public, anon, authenticated, service_role;",
    );
    expect(migration).toContain(
      "grant execute on function public.import_canonical_question_preview_release_v1(\n  uuid, jsonb, jsonb\n) to service_role;",
    );
    for (const signature of [
      "public.list_active_canonical_question_preview_v1(\n  uuid, uuid[], text\n)",
      "public.get_canonical_assignment_preview_result_v1(\n  uuid, text\n)",
      "public.create_bulk_canonical_assignments_preview_v1(\n  uuid, text, jsonb\n)",
    ]) {
      expect(migration).toContain(
        `revoke all on function ${signature} from public, anon, authenticated, service_role;`,
      );
      expect(migration).toContain(
        `grant execute on function ${signature} to authenticated;`,
      );
    }
  });

  it("binds the imported manifest and every item to fixed reviewed hashes", () => {
    expect(migration).toContain(
      "'e3a170879e18b233fcd6cd5e740bc0c09fd4a42cbf5d694a226d71159602e28a'",
    );
    expect(migration).toContain(
      "'45156c1a74b6ffb32694520899b3a9e4ae22840d61e49b049a1650b337b9e1a0'",
    );
    expect(migration).toContain(
      "'b3427ba68fb16f03313ebb5c76a6fe39d2150ac205ab6c917770735124013973'",
    );
    expect(migration).toContain(
      "'3a5db0dc770f5d8143ed4a35f4d18280da91cdab369b3447b014097e8135da5b'",
    );
    expect(migration).toContain("expected_item_count = 512");
    expect(migration).toContain("expected_expanded_count = 540");
    expect(migration).toContain("expected_source_entry_count = 270");
    expect(migration).toContain("canonical_approved boolean not null check (not canonical_approved)");
    expect(migration).toContain("release_allowed boolean not null check (not release_allowed)");
    expect(migration).toContain(
      "production_apply_allowed boolean not null check (not production_apply_allowed)",
    );
  });
});
