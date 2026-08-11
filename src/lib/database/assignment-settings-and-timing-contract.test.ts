import fs from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

function source(relativePath: string) {
  return fs.readFileSync(path.resolve(relativePath), "utf8");
}

describe("assignment order and timing database contract", () => {
  it("adds ascending and descending without removing legacy fixed rows", () => {
    const enumMigration = source(
      "supabase/migrations/20260730235000_expand_question_order_modes.sql",
    );
    const behaviorMigration = source(
      "supabase/migrations/20260730235100_add_assignment_timing_and_order_behavior.sql",
    );

    expect(enumMigration).toContain("'ascending'");
    expect(enumMigration).toContain("'descending'");
    expect(behaviorMigration).toContain(
      "question_order_mode in ('fixed', 'ascending')",
    );
    expect(behaviorMigration).toContain(
      "question_order_mode = 'descending'",
    );
    expect(behaviorMigration).toContain(
      "question_order_mode = 'random'",
    );
  });

  it("stores one timing mode and restores a server question clock", () => {
    const migration = source(
      "supabase/migrations/20260730235100_add_assignment_timing_and_order_behavior.sql",
    );

    expect(migration).toContain(
      "timing_mode in ('total', 'per_question')",
    );
    expect(migration).toContain("current_question_started_at");
    expect(migration).toContain("question_time_limit_seconds");
    expect(migration).toContain(
      "create function public.answer_quiz_question_v2",
    );
    expect(migration).toContain("p_force_timeout and not timed_out");
    expect(migration).toContain("initial_timed_out = true");
    expect(migration).toContain("retry_timed_out = true");
    expect(migration).toContain("'questionDeadlineAt'");
  });

  it("keeps the public timing RPC invoker-only", () => {
    const migration = source(
      "supabase/migrations/20260730235200_harden_assignment_delivery_rpc.sql",
    );

    expect(migration).toContain(
      "create function private.configure_assignment_delivery_v1",
    );
    expect(migration).toContain(
      "create or replace function public.configure_assignment_delivery_v1",
    );
    expect(migration).toContain("security invoker");
  });

  it("client uses the server deadline and sends timeout separately", () => {
    const player = source("src/components/quiz-player.tsx");
    const quizService = source("src/lib/services/quiz-service.ts");
    const timeoutRoute = source(
      "src/app/api/student/attempts/[id]/timeouts/route.ts",
    );
    const copy = source("src/content/ko/student-app.ts");

    expect(player).toContain("attempt.timerDeadlineAt");
    expect(player).toContain("const nextTimerDeadlineAt =");
    expect(player).toMatch(
      /setRemaining\(\s*secondsUntil\(\s*nextTimerDeadlineAt,/,
    );
    expect(player).toContain('choiceIndex === null ? "timeouts" : "answers"');
    expect(player).toContain("studentAppText.attempt.timedOut");
    expect(player).toContain("const answerAnnouncement =");
    expect(player).toContain('className="sr-only"');
    expect(player).not.toContain('className="feedback feedback-wrong"');
    expect(copy).toContain(
      'timedOut: "시간 초과로 미응답 오답 처리했습니다."',
    );
    expect(quizService).toContain('"answer_quiz_question_v2"');
    expect(timeoutRoute).toContain("timeoutStudentQuestion");
  });
});

describe("Kakao code sharing contract", () => {
  it("uses Kakao Talk SDK and keeps explicit message copy fallback", () => {
    const codePanel = source(
      "src/features/students/ui/panels/student-code-panel.tsx",
    );
    const controller = source(
      "src/features/students/controller/use-student-detail-controller.ts",
    );
    const kakao = source("src/lib/kakao-share.ts");
    const copy = source("src/content/ko/admin-students.ts");

    expect(codePanel).toContain("adminStudentsText.codeModal.sendKakao");
    expect(copy).toContain('sendKakao: "카카오톡으로 보내기"');
    expect(controller).not.toContain("navigator.share");
    expect(controller).toContain("navigator.clipboard.writeText(message)");
    expect(kakao).toContain("kakao.Share");
    expect(kakao).toContain("NEXT_PUBLIC_KAKAO_JAVASCRIPT_KEY");
    expect(kakao).toContain("objectType: \"text\"");
    expect(kakao).toContain("script.integrity");
  });
});
