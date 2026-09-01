import type { Page, Route } from "@playwright/test";

import { expect, test } from "../fixtures/preview-run";
import {
  assignBulkRange,
  assignDirectReview,
  assignSingleRange,
  finishInitialChoosingFirst,
  finishPhaseByTimeout,
  finishRetry,
  openSingleAssignment,
  startLatestAssignment,
} from "../support/vocab-journey";

type QueueSummary = {
  completedSessionCount: number;
  items: Array<{ assignmentId: string | null; status: string }>;
  remainingSessionCount: number;
  studentId: string;
  totalSessionCount: number;
};

type AdminPointSummary = {
  correctReward: number;
  currentPoints: number;
  netChange: number;
  wrongEffect: number;
};

function pointChangeText(value: number) {
  return value > 0 ? `+${value}` : String(value);
}

const assignmentMutationPaths = new Set([
  "/api/admin/assignments",
  "/api/admin/bulk-assignments",
  "/api/admin/exact-review-assignments",
  "/api/admin/mixed-assignments",
]);

async function trackAdminAssignmentMutations(page: Page) {
  const requests: string[] = [];
  const listener = async (route: Route) => {
    const request = route.request();
    const pathname = new URL(request.url()).pathname;
    if (
      request.method() === "POST" &&
      assignmentMutationPaths.has(pathname)
    ) {
      requests.push(pathname);
      await route.abort("blockedbyclient");
      return;
    }
    await route.continue();
  };
  await page.route("**/api/admin/**", listener);
  return {
    async assertNone() {
      await new Promise((resolve) => setTimeout(resolve, 750));
      expect(
        requests,
        `검증 실패 뒤 저장 요청이 발생했습니다: ${requests.join(", ")}`,
      ).toEqual([]);
    },
    async stop() {
      await page.unroute("**/api/admin/**", listener);
    },
  };
}

async function expectAdminPointSummary(
  page: Page,
  attemptId: string,
  expected: AdminPointSummary,
) {
  const response = await page.goto(`/admin/results/attempt.${attemptId}`);
  expect(response?.status()).toBe(200);
  const values = page.locator('[data-point-summary="admin-attempt"] dd');
  await expect(values).toHaveText([
    pointChangeText(expected.correctReward),
    pointChangeText(expected.wrongEffect),
    pointChangeText(expected.netChange),
    String(expected.currentPoints),
  ]);
}

async function loadQueue(
  page: Page,
  studentId: string,
): Promise<QueueSummary | null> {
  const response = await page.request.get(
    `/api/admin/students/${studentId}/vocab-assignment-queues`,
  );
  const responseText = await response.text();
  expect(response.status(), responseText).toBe(200);
  const payload = JSON.parse(responseText) as { queues?: QueueSummary[] };
  return payload.queues?.find((queue) => queue.studentId === studentId) ?? null;
}

test.describe.serial("@authenticated Preview 인증 단어 배정 핵심 흐름", () => {
  test("정상 1 · 단일 배정 뒤 학생이 실제 시험을 시작한다", async ({ previewRun }) => {
    const student = await previewRun.createStudent("normal-single");
    await assignSingleRange(previewRun.adminPage, student, {
      rangeMode: "all",
      scheduleEnabled: false,
      timeLimit: "none",
    });
    const studentPage = await previewRun.openStudent(student);
    await startLatestAssignment(studentPage);
    await expect(studentPage.locator("#quiz-prompt")).toBeVisible();
    await expect(studentPage.locator('button[data-feedback="idle"]')).toHaveCount(4);
    await studentPage.close();
  });

  test("정상 2 · 일괄 배정은 두 학생 모두 같은 준비 화면에서 시험을 시작한다", async ({
    previewRun,
  }) => {
    const students = await Promise.all([
      previewRun.createStudent("normal-bulk-a"),
      previewRun.createStudent("normal-bulk-b"),
    ]);
    await assignBulkRange(previewRun.adminPage, students, {
      rangeMode: "all",
      scheduleEnabled: false,
      timeLimit: "none",
    });
    for (const student of students) {
      const page = await previewRun.openStudent(student);
      await startLatestAssignment(page);
      await expect(page.locator("#quiz-prompt")).toBeVisible();
    }
  });

  test("정상 3 · 일반 재시험에서 남긴 오답을 독립 오답 시험으로 풀고 포인트를 화면에 반영한다", async ({
    previewRun,
  }) => {
    const student = await previewRun.createStudent("normal-review");
    await assignSingleRange(previewRun.adminPage, student, {
      rangeMode: "first-unit",
      scheduleEnabled: false,
      timeLimit: "per-question",
    });
    const studentPage = await previewRun.openStudent(student);
    await startLatestAssignment(studentPage);
    const regularAttemptId = new URL(studentPage.url()).pathname.split("/").at(-1)!;
    const regularAnswers = await finishPhaseByTimeout(studentPage);
    expect(regularAnswers.size).toBe(4);
    await finishRetry(studentPage, regularAnswers, "wrong");
    await expect(studentPage.getByText("재시험 후에도 다시 볼 단어가 남았습니다.")).toBeVisible();
    await expectAdminPointSummary(previewRun.adminPage, regularAttemptId, {
      correctReward: 0,
      currentPoints: 0,
      netChange: -12,
      wrongEffect: -12,
    });

    await assignDirectReview(previewRun.adminPage, student);
    await startLatestAssignment(studentPage, { review: true });
    const reviewAttemptId = new URL(studentPage.url()).pathname.split("/").at(-1)!;
    const reviewAnswers = await finishPhaseByTimeout(studentPage);
    expect(reviewAnswers.size).toBe(4);
    await finishRetry(studentPage, reviewAnswers, "correct");
    await expect(studentPage.getByText("재시험에서 틀린 단어를 모두 해결했습니다.")).toBeVisible();
    await expectAdminPointSummary(previewRun.adminPage, reviewAttemptId, {
      correctReward: 4,
      currentPoints: 0,
      netChange: 4,
      wrongEffect: 0,
    });
    const resultPoints = studentPage.locator('[data-point-summary="student-attempt"] dd');
    await expect(resultPoints).toHaveText(["4", "0"]);
    await studentPage.getByRole("link", { name: "내 시험으로 돌아가기" }).click();
    await expect(
      studentPage.locator('[data-point-summary="current"] dd'),
    ).toHaveText("0");
  });

  test("경계 1 · 같은 시험 시작을 다시 요청해도 진행 중 응시 하나를 재사용한다", async ({
    previewRun,
  }) => {
    const student = await previewRun.createStudent("boundary-reuse");
    await assignSingleRange(previewRun.adminPage, student, {
      rangeMode: "first-unit",
      scheduleEnabled: false,
      timeLimit: "per-question",
      perQuestionSeconds: 8,
    });
    const studentPage = await previewRun.openStudent(student);
    const assignmentId = await startLatestAssignment(studentPage);
    const attemptId = new URL(studentPage.url()).pathname.split("/").at(-1)!;
    const [first, second] = await Promise.all([
      studentPage.request.post(
        `/api/student/assignments/${assignmentId}/attempts`,
      ),
      studentPage.request.post(
        `/api/student/assignments/${assignmentId}/attempts`,
      ),
    ]);
    expect(first.status()).toBe(201);
    expect(second.status()).toBe(201);
    const firstPayload = (await first.json()) as { attemptId: string };
    const secondPayload = (await second.json()) as { attemptId: string };
    expect(firstPayload.attemptId).toBe(attemptId);
    expect(secondPayload.attemptId).toBe(attemptId);
    const answers = await finishPhaseByTimeout(studentPage);
    expect(answers.size).toBe(4);
    await finishRetry(studentPage, answers, "correct");
    await expectAdminPointSummary(previewRun.adminPage, attemptId, {
      correctReward: 8,
      currentPoints: 0,
      netChange: -4,
      wrongEffect: -12,
    });
    await expect(
      studentPage.locator('[data-point-summary="student-attempt"] dd'),
    ).toHaveText(["0", "0"]);
  });

  test("경계 2 · 회차별 배정은 첫 시험 완료 뒤 다음 회차를 정확히 한 건 만든다", async ({
    previewRun,
  }) => {
    const student = await previewRun.createStudent("boundary-series");
    const response = await assignSingleRange(previewRun.adminPage, student, {
      rangeMode: "two-units",
      scheduleEnabled: true,
      timeLimit: "per-question",
    });
    const result = response as {
      assignments?: Array<{ status?: "assigned" | "queued" }>;
    };
    expect(
      result.assignments?.filter((assignment) => assignment.status === "queued")
        .length,
    ).toBeGreaterThanOrEqual(1);
    const before = await loadQueue(previewRun.adminPage, student.id);
    expect(before?.totalSessionCount).toBeGreaterThanOrEqual(2);

    const studentPage = await previewRun.openStudent(student);
    await startLatestAssignment(studentPage);
    await finishInitialChoosingFirst(studentPage);
    await expect.poll(
      async () => {
        const queue = await loadQueue(previewRun.adminPage, student.id);
        if (!queue) return null;
        const assignmentIds = queue.items
          .map((item) => item.assignmentId)
          .filter((id): id is string => Boolean(id));
        return {
          completed: queue.completedSessionCount,
          distinctAssignments: new Set(assignmentIds).size,
          materializedAssignments: assignmentIds.length,
        };
      },
      { timeout: 20_000 },
    ).toEqual({
      completed: 1,
      distinctAssignments: 2,
      materializedAssignments: 2,
    });
  });

  test("경계 3 · 시험일·시간 제한 없이 서로 다른 범위 두 시험이 함께 시작된다", async ({
    previewRun,
  }) => {
    const student = await previewRun.createStudent("boundary-coexist");
    await assignSingleRange(previewRun.adminPage, student, {
      rangeMode: "first-unit",
      scheduleEnabled: false,
      timeLimit: "none",
    });
    await assignSingleRange(previewRun.adminPage, student, {
      rangeMode: "second-unit",
      scheduleEnabled: false,
      timeLimit: "none",
    });
    const studentPage = await previewRun.openStudent(student);
    await studentPage.goto("/student");
    await expect(
      studentPage.locator('article[data-assignment-id]').filter({
        has: studentPage.getByRole("button", { name: "시험 시작" }),
      }),
    ).toHaveCount(2);
    const firstAssignment = await startLatestAssignment(studentPage);
    const firstAttempt = studentPage.url();
    await studentPage.goto("/student");
    const secondAssignment = await startLatestAssignment(studentPage);
    expect(secondAssignment).not.toBe(firstAssignment);
    expect(studentPage.url()).not.toBe(firstAttempt);
  });

  test("실패 1 · 비로그인·다른 출처의 관리자와 학생 쓰기 요청을 차단한다", async ({
    previewRun,
  }) => {
    const anonymous = await previewRun.openAnonymousContext();
    const unauthenticatedAdmin = await anonymous.request.post("/api/admin/students", {
      data: { displayName: "[E2E] 차단 확인" },
    });
    expect(unauthenticatedAdmin.status()).toBe(401);
    const unauthenticatedStudent = await anonymous.request.post(
      "/api/student/assignments/00000000-0000-4000-8000-000000000000/attempts",
    );
    expect(unauthenticatedStudent.status()).toBe(401);
    const wrongOrigin = await previewRun.adminContext.request.post(
      "/api/admin/students",
      {
        data: { displayName: "[E2E] 출처 차단 확인" },
        headers: { origin: "https://example.invalid" },
      },
    );
    expect(wrongOrigin.status()).toBe(403);
  });

  test("실패 2 · 단일 배정의 범위 누락은 해당 구역에서 막고 저장하지 않는다", async ({
    previewRun,
  }) => {
    const student = await previewRun.createStudent("failure-single-range");
    await openSingleAssignment(previewRun.adminPage, student);
    const mutations = await trackAdminAssignmentMutations(previewRun.adminPage);
    try {
      await previewRun.adminPage.getByRole("button", { name: "배정하기" }).click();
      await expect(
        previewRun.adminPage.getByText("범위 확인", { exact: true }),
      ).toBeVisible();
      await expect(
        previewRun.adminPage.locator('[data-field-key="range"]'),
      ).toContainText(/범위/);
      await mutations.assertNone();
      await previewRun.adminPage.getByRole("button", { name: "닫기" }).click();
    } finally {
      await mutations.stop();
    }
  });

  test("실패 3 · 일괄 대상 없음과 오답 없음은 배정 전에 차단한다", async ({
    previewRun,
  }) => {
    await previewRun.adminPage.goto("/admin/assignments");
    const mutations = await trackAdminAssignmentMutations(previewRun.adminPage);
    try {
      await previewRun.adminPage.getByRole("tab", { name: "일괄 배정" }).click();
      await expect(
        previewRun.adminPage.getByRole("button", {
          name: "단어 배정",
          exact: true,
        }),
      ).toBeDisabled();
      await mutations.assertNone();

      const student = await previewRun.createStudent("failure-empty-review");
      await openSingleAssignment(previewRun.adminPage, student);
      await previewRun.adminPage.getByRole("tab", { name: "오답 시험" }).click();
      await expect(
        previewRun.adminPage.getByText("현재 배정할 오답이 없습니다."),
      ).toBeVisible();
      await previewRun.adminPage.getByRole("button", { name: "배정하기" }).click();
      await expect(
        previewRun.adminPage.getByRole("dialog", { name: "단일 배정" }),
      ).toBeVisible();
      await expect(
        previewRun.adminPage.getByText("범위 확인", { exact: true }),
      ).toBeVisible();
      await mutations.assertNone();
      await previewRun.adminPage.getByRole("button", { name: "닫기" }).click();
    } finally {
      await mutations.stop();
    }
  });
});
