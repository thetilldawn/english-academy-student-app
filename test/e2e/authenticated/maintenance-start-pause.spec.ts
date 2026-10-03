import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import type { Page } from "@playwright/test";
import { test, expect } from "../fixtures/preview-run";
import { assignSingleRange } from "../support/vocab-journey";
import { chooseLocalAnswer, finishLocalPhase, readLocalRun, startLocalAssignment, startLocalRetry } from "../support/local-quiz-journey";
import { MAINTENANCE_PREVIEW_ORIGIN } from "../support/environment";

const datasetId = "b6100000-0000-4000-8000-000000000004";
const controlDirectory = path.join(process.cwd(), ".codex-tmp", "DEPLOY-20261003-01");
const checkpointPath = path.join(controlDirectory, "pause-checkpoint.json");
const acknowledgmentPath = path.join(controlDirectory, "pause-acknowledgment.json");
const pausedError = {
  code: "quiz_new_attempts_paused",
  error: "점검 중이라 새 시험을 시작할 수 없습니다. 잠시 후 다시 시도해 주세요. 진행 중인 시험은 계속할 수 있습니다.",
};

function assignmentId(value: unknown, studentId: string) {
  const rows = (value as { assignments: Array<{ student_id: string; status: string; assignment_id: string }> }).assignments
    .filter(row => row.student_id === studentId && row.status === "assigned");
  expect(rows).toHaveLength(1);
  expect(rows[0].assignment_id).toMatch(/^[0-9a-f-]{36}$/);
  return rows[0].assignment_id;
}

function waitForAction(page: Page, action: string) {
  return page.waitForResponse(response => response.request().method() === "POST" &&
    new URL(response.url()).pathname === "/api/student/local-quiz" && response.request().postDataJSON()?.action === action);
}

test.describe("@authenticated 유지보수 새 시작 중지와 기존 답 보존", () => {
  test.skip(process.env.E2E_MAINTENANCE_ROLLBACK !== "1", "유지보수 전용 실행만 허용합니다.");

  test("새 시작만 멈추고 기존 시험·재시험 저장과 같은 준비의 재개를 허용한다", async ({ previewRun }) => {
    test.setTimeout(420_000);
    expect(previewRun.origin).toBe(MAINTENANCE_PREVIEW_ORIGIN);
    const token = randomUUID();
    const identity = { token, origin: previewRun.origin, targetSha: previewRun.targetDeploymentSha, projectRef: "wojxpruvbjzbhrpmsbuy" };
    let needsRestore = false;
    const fixture: Record<string, unknown> = {};
    function checkpoint(stage: string, details: Record<string, unknown> = {}) {
      fs.mkdirSync(controlDirectory, { recursive: true });
      fs.writeFileSync(checkpointPath, JSON.stringify({ ...identity, stage, ...fixture, ...details, at: new Date().toISOString() }, null, 2) + "\n");
      console.log(`M10 시작 제어: ${stage} (${token})`);
    }
    async function waitForAcknowledgment(stage: string) {
      await expect.poll(() => {
        try {
          const value = JSON.parse(fs.readFileSync(acknowledgmentPath, "utf8"));
          return value.token === token && value.stage === stage && value.origin === identity.origin &&
            value.targetSha === identity.targetSha && value.projectRef === identity.projectRef && value.verified === true;
        } catch { return false; }
      }, { timeout: 90_000, intervals: [500, 1000, 2000], message: `메인 작업자의 ${stage} DB 확인 대기` }).toBe(true);
    }

    try {
      const studentA = await previewRun.createStudent("m10-pause-existing");
      const studentB = await previewRun.createStudent("m10-pause-new");
      const options = { datasetId, questionCount: 4, rangeMode: "all" as const, scheduleEnabled: false, timeLimit: "none" as const };
      const assignmentA = assignmentId(await assignSingleRange(previewRun.adminPage, studentA, options), studentA.id);
      const assignmentB = assignmentId(await assignSingleRange(previewRun.adminPage, studentB, options), studentB.id);
      const pageA = await previewRun.openStudent(studentA);
      const pageB = await previewRun.openStudent(studentB);
      const original = await startLocalAssignment(pageA, assignmentA);
      await chooseLocalAnswer(pageA, false);
      const saved = await readLocalRun(pageA);
      expect(saved.answers).toHaveLength(1);
      Object.assign(fixture, { studentA: studentA.id, studentB: studentB.id, assignmentA, assignmentB, attemptA: original.plan!.attemptId });
      await previewRun.verifyCurrentDeployment();
      needsRestore = true;
      checkpoint("ready-to-pause");
      await waitForAcknowledgment("pause-confirmed");

      await pageB.goto("/student");
      const stopExpectedPause = previewRun.allowPausedQuizStarts(pageB);
      let blockedBody: unknown;
      try {
        const prepareResponse = waitForAction(pageB, "prepare");
        const beginResponse = waitForAction(pageB, "begin");
        await pageB.locator(`article[data-assignment-id="${assignmentB}"]`).getByRole("button", { name: "시험 시작", exact: true }).click();
        expect((await prepareResponse).status()).toBe(200);
        const blocked = await beginResponse;
        expect(blocked.status()).toBe(503);
        expect(await blocked.json()).toEqual(pausedError);
        blockedBody = blocked.request().postDataJSON();
        await pageB.waitForURL(/\/quiz-offline#[0-9a-f-]{36}$/);
        await expect(pageB.getByRole("main").getByRole("alert")).toHaveText(pausedError.error);
        await expect(pageB.locator("#quiz-prompt")).toHaveCount(0);
        const retryResponse = waitForAction(pageB, "begin");
        await pageB.getByRole("button", { name: "다시 확인", exact: true }).click();
        const blockedAgain = await retryResponse;
        expect(blockedAgain.status()).toBe(503);
        expect(await blockedAgain.json()).toEqual(pausedError);
        expect(blockedAgain.request().postDataJSON()).toEqual(blockedBody);
        await expect(pageB.getByRole("main").getByRole("alert")).toHaveText(pausedError.error);
        await expect.poll(() => previewRun.expectedPausedStarts.length).toBe(2);
      } finally { stopExpectedPause(); }
      const prepared = await readLocalRun(pageB);
      const preparedUrl = pageB.url();
      expect(prepared).toMatchObject({ plan: null, batch: null, receipt: null, answers: [], startRequested: true });
      expect(prepared.preparation.assignmentId).toBe(assignmentB);
      expect((await readLocalRun(pageA)).answers).toEqual(saved.answers);
      const initial = await finishLocalPhase(pageA, [1]);
      expect(initial.result).toMatchObject({ state: "retry_waiting", finalized: false, attempt: { initialScore: 50 } });
      await startLocalRetry(pageA);
      expect((await readLocalRun(pageA)).plan?.attemptId).toBe(original.plan!.attemptId);
      const retry = await finishLocalPhase(pageA, [0]);
      expect(retry.result).toMatchObject({ state: "failed", finalized: true, attempt: { initialScore: 50, finalScore: 75, passed: false, unresolvedWrongCount: 1 } });
      checkpoint("paused-checks-done", { preparationB: prepared.key, initialScoreA: 50, finalScoreA: 75 });
      await waitForAcknowledgment("resume-confirmed");
      needsRestore = false;

      const resumedResponse = waitForAction(pageB, "begin");
      await pageB.getByRole("button", { name: "다시 확인", exact: true }).click();
      const resumed = await resumedResponse;
      expect(resumed.status()).toBe(200);
      expect(resumed.request().postDataJSON()).toEqual(blockedBody);
      await expect(pageB.locator("#quiz-prompt")).toBeVisible();
      expect(pageB.url()).toBe(preparedUrl);
      const started = await readLocalRun(pageB);
      expect(started.key).toBe(prepared.key);
      expect(started.preparation).toEqual(prepared.preparation);
      expect(started.device).toEqual(prepared.device);
      const final = await finishLocalPhase(pageB);
      expect(final.result).toMatchObject({ finalized: true, attempt: { finalScore: 100, passed: true } });
      const result = { ...identity, ...fixture, attemptB: started.plan!.attemptId, preparationB: prepared.key,
        blockedBeginStatuses: [503, 503], initialScoreA: 50, finalScoreA: 75, finalScoreB: 100,
        samePreparationAfterResume: true, sameBeginRequestAfterResume: true };
      const reportDirectory = path.join(process.cwd(), "test-results", "maintenance-preview");
      fs.mkdirSync(reportDirectory, { recursive: true });
      fs.writeFileSync(path.join(reportDirectory, "점검중_새시작과_기존답.json"), JSON.stringify(result, null, 2) + "\n");
      await pageB.screenshot({ path: test.info().outputPath("점검후_같은준비_완료.png") });
      checkpoint("completed", result);
    } finally {
      if (needsRestore) {
        checkpoint("restore-required");
        await waitForAcknowledgment("restored-after-failure");
        checkpoint("restored-after-failure");
      }
    }
  });
});
