import { loadEnvConfig } from "@next/env";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

import { assertStagingFixtureEnvironment } from "../src/test-support/staging-fixture-safety";

const FIXTURE_PREFIX = "ui-component-preview-fixture-v1";
const CHILD_TABLES = [
  "student_codes",
  "student_sessions",
  "assignment_students",
  "quiz_attempts",
  "student_vocab_state",
  "student_vocab_wrong_events",
  "student_vocab_review_queue",
  "student_vocab_review_assignment_drafts",
  "student_learning_sources",
  "notification_receipts",
  "worksheet_requests",
] as const;

type FixtureStudent = {
  id: string;
  display_name: string;
  school_name: string | null;
  grade_label: string | null;
  note: string | null;
  status: "active" | "blocked";
  deleted_at: string | null;
  code_generation: number;
  created_by: string;
};

function fixtureIdentity(runId: string) {
  if (!/^[a-z0-9-]{1,40}$/.test(runId)) {
    throw new Error("run id는 영문 소문자, 숫자, 하이픈만 사용할 수 있습니다.");
  }
  return {
    displayName: `[E2E] UI 검증 ${runId}`,
    marker: `${FIXTURE_PREFIX}:${runId}`,
  };
}

async function findFixture(
  supabase: SupabaseClient,
  marker: string,
): Promise<FixtureStudent | null> {
  const { data, error } = await supabase
    .from("students")
    .select(
      "id, display_name, school_name, grade_label, note, status, deleted_at, code_generation, created_by",
    )
    .eq("note", marker)
    .limit(2);
  if (error) throw error;
  if ((data?.length ?? 0) > 1) {
    throw new Error("동일 marker의 UI fixture가 두 개 이상 존재합니다.");
  }
  return (data?.[0] as FixtureStudent | undefined) ?? null;
}

function assertFixtureIdentity(
  student: FixtureStudent,
  identity: ReturnType<typeof fixtureIdentity>,
) {
  if (
    student.display_name !== identity.displayName ||
    student.school_name !== "미리보기고" ||
    student.grade_label !== "고3" ||
    student.note !== identity.marker
  ) {
    throw new Error("기존 행이 요청한 UI fixture 식별자와 일치하지 않습니다.");
  }
}

async function ensureFixture(
  supabase: SupabaseClient,
  runId: string,
) {
  const identity = fixtureIdentity(runId);
  const existing = await findFixture(supabase, identity.marker);
  if (existing) {
    assertFixtureIdentity(existing, identity);
    if (existing.deleted_at || existing.status !== "active") {
      throw new Error("이미 정리된 run id입니다. 새 run id를 사용하세요.");
    }
    return { action: "reused", id: existing.id, marker: identity.marker };
  }

  const { data: admins, error: adminError } = await supabase
    .from("admin_profiles")
    .select("user_id")
    .eq("is_active", true)
    .limit(2);
  if (adminError) throw adminError;
  if (admins?.length !== 1) {
    throw new Error("staging의 활성 관리자 1명을 확정할 수 없습니다.");
  }

  const { data, error } = await supabase
    .from("students")
    .insert({
      created_by: admins[0].user_id,
      display_name: identity.displayName,
      grade_label: "고3",
      note: identity.marker,
      school_name: "미리보기고",
    })
    .select("id")
    .single();
  if (error) throw error;
  return { action: "created", id: data.id, marker: identity.marker };
}

async function assertNoFixtureChildren(
  supabase: SupabaseClient,
  studentId: string,
) {
  for (const table of CHILD_TABLES) {
    const { count, error } = await supabase
      .from(table)
      .select("*", { count: "exact", head: true })
      .eq("student_id", studentId);
    if (error) throw error;
    if ((count ?? 0) > 0) {
      throw new Error(`${table}에 자식 기록이 있어 자동 정리를 중단합니다.`);
    }
  }
}

async function cleanupFixture(
  supabase: SupabaseClient,
  runId: string,
) {
  const identity = fixtureIdentity(runId);
  const existing = await findFixture(supabase, identity.marker);
  if (!existing) {
    return { action: "not_found", marker: identity.marker };
  }
  assertFixtureIdentity(existing, identity);
  if (existing.deleted_at || existing.status === "blocked") {
    return { action: "already_cleaned", id: existing.id, marker: identity.marker };
  }

  await assertNoFixtureChildren(supabase, existing.id);
  const deletedAt = new Date().toISOString();
  const { data, error } = await supabase
    .from("students")
    .update({
      code_generation: existing.code_generation + 1,
      deleted_at: deletedAt,
      deleted_by: existing.created_by,
      status: "blocked",
    })
    .eq("id", existing.id)
    .eq("note", identity.marker)
    .eq("display_name", identity.displayName)
    .eq("code_generation", existing.code_generation)
    .is("deleted_at", null)
    .select("id");
  if (error) throw error;
  if (data?.length !== 1) {
    throw new Error("UI fixture 한 행만 정리한다는 조건을 충족하지 못했습니다.");
  }
  return { action: "soft_deleted", id: existing.id, marker: identity.marker };
}

async function main() {
  loadEnvConfig(process.cwd());
  const [command, runId] = process.argv.slice(2);
  if ((command !== "ensure" && command !== "cleanup") || !runId) {
    throw new Error(
      "사용법: npm run fixture:ui:ensure -- <run-id> 또는 npm run fixture:ui:cleanup -- <run-id>",
    );
  }

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  assertStagingFixtureEnvironment({
    expectedProjectRef: process.env.PREVIEW_EXPECTED_SUPABASE_PROJECT_REF,
    supabaseUrl,
    vercelEnvironment: process.env.VERCEL_ENV,
  });
  const secretKey = process.env.SUPABASE_SECRET_KEY;
  if (!supabaseUrl || !secretKey) {
    throw new Error("staging fixture용 Supabase 환경변수가 누락되었습니다.");
  }

  const supabase = createClient(supabaseUrl, secretKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const result =
    command === "ensure"
      ? await ensureFixture(supabase, runId)
      : await cleanupFixture(supabase, runId);
  console.log(JSON.stringify(result));
}

main().catch((error: unknown) => {
  console.error(
    error instanceof Error
      ? error.message
      : JSON.stringify(error, null, 2),
  );
  process.exitCode = 1;
});
