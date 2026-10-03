import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import type { Page } from "@playwright/test";
import type { QuizAttemptResponse, QuizAnswerResponse } from "../../../src/features/quiz-player/model";
import { test, expect, type PreviewStudent } from "../fixtures/preview-run";
import { assignSingleRange } from "../support/vocab-journey";
import { chooseLocalAnswer, finishLocalPhase, observeQuizRequests, readLocalRun, startLocalAssignment } from "../support/local-quiz-journey";
import { MAINTENANCE_PREVIEW_ORIGIN } from "../support/environment";

const datasetId = "b6100000-0000-4000-8000-000000000004";
function assignmentId(value: unknown, studentId: string) {
  const rows = (value as { assignments: Array<{ student_id: string; status: string; assignment_id: string }> }).assignments
    .filter(row => row.student_id === studentId && row.status === "assigned");
  expect(rows).toHaveLength(1);
  expect(rows[0].assignment_id).toMatch(/^[0-9a-f-]{36}$/);
  return rows[0].assignment_id;
}
function report(name: string, value: unknown) {
  const folder = path.join(process.cwd(), "test-results", "maintenance-preview");
  fs.mkdirSync(folder, { recursive: true });
  fs.writeFileSync(path.join(folder, name + ".json"), JSON.stringify(value, null, 2) + "\n");
}
const fingerprint = (run: Awaited<ReturnType<typeof readLocalRun>>) => createHash("sha256")
  .update(JSON.stringify({ key: run.key, plan: run.plan, answers: run.answers, batch: run.batch })).digest("hex");
async function changeStudent(page: Page, student: PreviewStudent) {
  await page.goto("/student");
  await page.getByRole("button", { name: "접속 종료", exact: true }).click();
  await page.waitForURL(url => url.pathname === "/");
  await page.getByRole("textbox", { name: "학생 접속코드", exact: true }).fill(student.code);
  await Promise.all([page.waitForURL(/\/student(?:\/)?$/), page.getByRole("button", { name: "인증", exact: true }).click()]);
  await expect(page.getByRole("banner")).toContainText(student.displayName);
}

test.describe("@authenticated 유지보수 구형 시험과 기기·계정 보존", () => {
  test.skip(process.env.E2E_MAINTENANCE_ROLLBACK !== "1", "유지보수 전용 실행만 허용합니다.");

  test("같은 기기의 두 탭·다른 기기·계정 변경에서 미제출 답을 보존한다", async ({ previewRun }) => {
    test.setTimeout(240_000);
    expect(previewRun.origin).toBe(MAINTENANCE_PREVIEW_ORIGIN);
    const owner = await previewRun.createStudent("m10-device-owner");
    const other = await previewRun.createStudent("m10-device-other");
    const assigned = assignmentId(await assignSingleRange(previewRun.adminPage, owner, {
      datasetId, questionCount: 4, rangeMode: "all", scheduleEnabled: false, timeLimit: "none",
    }), owner.id);
    const first = await previewRun.openStudent(owner);
    const run = await startLocalAssignment(first, assigned);
    const observedFirst = observeQuizRequests(first);
    await chooseLocalAnswer(first, true);
    expect(observedFirst.requests).toEqual([]);
    const saved = await readLocalRun(first);
    const savedHash = fingerprint(saved);
    const quizUrl = first.url();
    const second = await previewRun.openStudentTab(first);
    await second.goto(quizUrl);
    await expect(second.getByRole("main").getByRole("alert")).toContainText("다른 탭에서 이 시험을 진행 중입니다.");
    await expect(second.locator("#quiz-prompt")).toHaveCount(0);
    expect(fingerprint(await readLocalRun(second))).toBe(savedHash);
    await first.close();
    await second.reload();
    await expect(second.locator("#quiz-prompt")).toHaveAttribute("data-question-id", saved.plan!.items[1].id);
    expect(fingerprint(await readLocalRun(second))).toBe(savedHash);

    const differentDevice = await previewRun.openStudent(owner);
    await differentDevice.goto(`/student/attempt/${run.plan!.attemptId}`);
    await expect(differentDevice.getByRole("main").getByRole("alert")).toHaveText("이 시험은 처음 시작한 기기의 브라우저에서 이어서 진행해 주세요.");
    await expect(differentDevice.locator("#quiz-prompt")).toHaveCount(0);
    await differentDevice.close();

    const observed = observeQuizRequests(second);
    const session = await previewRun.openStudentTab(second);
    await changeStudent(session, other);
    await expect(second.getByRole("button", { name: "계정 확인 후 이어가기", exact: true })).toBeVisible();
    await expect(second.locator("#quiz-prompt")).toHaveCount(0);
    await expect(second.getByText(saved.preparation.title, { exact: true })).toHaveCount(0);
    expect(fingerprint(await readLocalRun(second))).toBe(savedHash);
    await second.getByRole("button", { name: "계정 확인 후 이어가기", exact: true }).click();
    await expect(second.getByRole("main").getByRole("alert")).toHaveText("시험을 시작한 학생으로 다시 로그인해 주세요. 답은 기기에 보관돼 있습니다.");
    expect(fingerprint(await readLocalRun(second))).toBe(savedHash);
    await changeStudent(session, owner);
    await second.getByRole("button", { name: "계정 확인 후 이어가기", exact: true }).click();
    await expect(second.locator("#quiz-prompt")).toHaveAttribute("data-question-id", saved.plan!.items[1].id);
    expect(fingerprint(await readLocalRun(second))).toBe(savedHash);
    expect(observed.requests.map(r => r.action)).toEqual(["identity", "identity"]);
    observed.stop();
    const receipt = await finishLocalPhase(second);
    expect(receipt.result).toMatchObject({ finalized: true, attempt: { finalScore: 100, passed: true } });
    await second.screenshot({ path: test.info().outputPath("계정복귀_답보존.png") });
    report("기기와계정", { studentId: owner.id, otherStudentId: other.id, assignmentId: assigned, attemptId: run.plan!.attemptId,
      savedAnswerCount: saved.answers.length, fingerprint: savedHash, sameTabResume: true, otherDeviceRejected: true,
      accountRecoveryIdentityCalls: 2, finalScore: 100 });
  });

  test("구형 방식의 진행 답·기한·재시험과 포인트를 재접속 뒤에도 보존한다", async ({ previewRun }) => {
    test.setTimeout(240_000);
    expect(previewRun.origin).toBe(MAINTENANCE_PREVIEW_ORIGIN);
    const student = await previewRun.createStudent("m10-legacy");
    const assigned = assignmentId(await assignSingleRange(previewRun.adminPage, student, {
      datasetId, direction: "english_to_korean", questionCount: 4, rangeMode: "all", scheduleEnabled: false, timeLimit: "total", totalMinutes: 5,
    }), student.id);
    let page = await previewRun.openStudent(student);
    const startPath = `/api/student/assignments/${assigned}/attempts`;
    const start = await page.request.post(startPath); // Deliberately omit the new preparation header.
    expect(start.status()).toBe(201);
    const { attemptId } = await start.json() as { attemptId: string };
    expect(attemptId).toMatch(/^[0-9a-f-]{36}$/);
    const apiPath = `/api/student/attempts/${attemptId}`;
    const attemptPath = `/student/attempt/${attemptId}`;
    const resultPath = `/student/result/${attemptId}`;
    async function readAttempt() {
      const response = await page.request.get(apiPath);
      expect(response.status()).toBe(200);
      return await response.json() as QuizAttemptResponse;
    }
    async function expectLegacy() {
      const response = await page.request.get(`/api/student/local-quiz-protocol/${attemptId}`);
      expect(response.status()).toBe(200);
      expect(await response.json()).toEqual({ local: false });
    }
    async function chooseLegacy(phase: "initial" | "retry", correct: boolean) {
      const { attempt } = await readAttempt();
      const q = attempt.questions.find(q => q.id === attempt.currentQuestionId)!;
      expect(q).toBeDefined();
      expect(q.direction).toBe("english_to_korean");
      expect(q.prompt).toMatch(/^m10sample[1-4]$/);
      const correctIndex = q.choices.indexOf(`검토 뜻 ${q.prompt.slice(-1)}`);
      expect(correctIndex).toBeGreaterThanOrEqual(0);
      const choiceIndex = correct ? correctIndex : (correctIndex + 1) % 4;
      await expect(page.locator("#quiz-prompt")).toHaveAttribute("data-question-id", q.id);
      const responsePromise = page.waitForResponse(r => new URL(r.url()).pathname === `${apiPath}/answers` && r.request().method() === "POST");
      await page.locator('button[data-feedback="idle"]').nth(choiceIndex).click();
      const response = await responsePromise;
      expect(response.request().postDataJSON()).toMatchObject({ questionId: q.id, phase, choiceIndex });
      expect(response.status()).toBe(200);
      const answer = await response.json() as QuizAnswerResponse;
      expect(answer.correct).toBe(correct);
      if (answer.needsRetry || answer.completed) await page.waitForURL(url => url.pathname === resultPath);
      else {
        await expect(page.locator("#quiz-prompt")).toHaveAttribute("data-question-id", answer.nextQuestionId!);
        await expect(page.locator('button[data-feedback="idle"]').first()).toBeEnabled();
      }
    }
    await expectLegacy();
    await page.goto(attemptPath);
    await chooseLegacy("initial", true);
    const before = await readAttempt();
    expect(before.attempt.questions.filter(q => q.initialChoiceIndex !== null)).toHaveLength(1);
    expect(before.attempt.timingMode).toBe("total");
    await page.close();
    page = await previewRun.openStudent(student);
    const resume = await page.request.post(startPath);
    expect(resume.status()).toBe(201);
    expect(await resume.json()).toEqual({ attemptId });
    await page.goto(attemptPath);
    await expectLegacy();
    const after = await readAttempt();
    expect(after.attempt).toEqual(before.attempt);
    expect(after.timerRemainingMilliseconds).toBeLessThanOrEqual(before.timerRemainingMilliseconds);
    await chooseLegacy("initial", true);
    await chooseLegacy("initial", true);
    await chooseLegacy("initial", false);
    await expect(page.getByRole("region", { name: "시험 기록" })).toContainText("75점 · 미통과");
    const retry = await page.request.post(`${apiPath}/retry`);
    expect(retry.status()).toBe(200);
    expect((await retry.json()).retry.phase).toBe("retry");
    await expectLegacy();
    await page.goto(attemptPath);
    await chooseLegacy("retry", true);
    await expect(page.getByRole("region", { name: "시험 기록" })).toContainText("75점 · 미통과");
    await expect(page.getByRole("region", { name: "시험 기록" })).toContainText("100점 · 통과");
    const points = page.locator('[data-point-summary="student-attempt"] dd');
    await expect(points).toHaveText(["5", "5"]);
    await page.reload();
    await expect(page.getByRole("region", { name: "시험 기록" })).toContainText("75점 · 미통과");
    await expect(page.getByRole("region", { name: "시험 기록" })).toContainText("100점 · 통과");
    await expect(points).toHaveText(["5", "5"]);
    await previewRun.adminPage.goto(`/admin/results/attempt.${attemptId}`);
    await expect(previewRun.adminPage.locator('[data-point-summary="admin-attempt"] dd')).toHaveText(["+8", "-3", "+5", "5"]);
    await page.goto("/student");
    await expect(page.getByRole("banner").getByRole("status").getByText("5", { exact: true })).toBeVisible();
    report("구형시험_보존", { studentId: student.id, assignmentId: assigned, attemptId, savedAnswerCount: 1,
      startedAt: before.attempt.startedAt, deadlineAt: before.attempt.deadlineAt, resumedDeadlineAt: after.attempt.deadlineAt,
      scores: [75, 100], points: { correct: 8, wrong: -3, net: 5, current: 5 }, localProtocol: false });
  });
});
