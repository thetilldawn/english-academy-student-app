import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { test, expect } from "../fixtures/preview-run";
import { assignSingleRange, assignDirectReview } from "../support/vocab-journey";
import { activeScreenBuild, chooseLocalAnswer, finishLocalPhase, readLocalRun, startLocalAssignment, startLocalRetry } from "../support/local-quiz-journey";
import { MAINTENANCE_PREVIEW_ORIGIN } from "../support/environment";

type Deployment = { id: string; origin: string; sha: string; build: string; workerHash: string };
type Plan = { origin: string; datasetId: string; a: Deployment; b: Deployment };
function readPlan(): Plan {
  expect(process.env.E2E_MAINTENANCE_ROLLBACK, "별칭 교체 검사는 별도 실행 승인이 필요합니다.").toBe("1");
  const plan = JSON.parse(fs.readFileSync(path.join(process.cwd(), ".codex-tmp/DEPLOY-20261003-01/active-plan.json"), "utf8")) as Plan;
  expect(plan.origin).toBe(MAINTENANCE_PREVIEW_ORIGIN);
  expect(plan.datasetId).toBe("b6100000-0000-4000-8000-000000000004");
  expect(plan.a.id).not.toBe(plan.b.id);
  expect(plan.a.build).not.toBe(plan.b.build);
  expect(plan.a.workerHash).not.toBe(plan.b.workerHash);
  expect(plan.b.sha).toBe(process.env.E2E_TARGET_DEPLOYMENT_SHA);
  expect(plan.b.origin).toBe(process.env.E2E_EXPECTED_DEPLOYMENT_ORIGIN);
  return plan;
}
function report(name: string, value: unknown) {
  const directory = path.join(process.cwd(), "test-results", "maintenance-preview");
  fs.mkdirSync(directory, { recursive: true });
  fs.writeFileSync(path.join(directory, name + ".json"), JSON.stringify(value, null, 2) + "\n");
}
function assignmentId(value: unknown, studentId: string, review = false) {
  const rows = (value as { assignments: Array<Record<string, unknown>> }).assignments.filter(row =>
    review ? row.studentId === studentId : row.student_id === studentId && row.status === "assigned");
  expect(rows).toHaveLength(1);
  const id = rows[0][review ? "assignmentId" : "assignment_id"];
  expect(id).toMatch(/^[0-9a-f-]{36}$/);
  return id as string;
}
const answerFingerprint = (run: Awaited<ReturnType<typeof readLocalRun>>) =>
  createHash("sha256").update(JSON.stringify({ key: run.key, plan: run.plan, answers: run.answers, batch: run.batch })).digest("hex");
function switchAlias(stage: "a" | "b") {
  // Main-owned operator tool independently pins project, alias, IDs, Git and DB.
  const output = execFileSync(process.execPath, [path.join(process.cwd(), ".codex-tmp/m10-switch-preview.mjs"), stage], {
    encoding: "utf8", windowsHide: true, stdio: ["ignore", "pipe", "pipe"], timeout: 50_000,
  });
  const result = JSON.parse(output);
  expect(result.stage).toBe(stage);
  expect(result.origin).toBe(MAINTENANCE_PREVIEW_ORIGIN);
}

test.describe.serial("@authenticated 유지보수 실제 회차 제출과 배포 복귀", () => {
  // Never run an operator-controlled alias switch in the ordinary CI suite.
  test.skip(process.env.E2E_MAINTENANCE_ROLLBACK !== "1", "유지보수 전용 실행만 허용합니다.");
  test("학습·최초·재시험·오답 해결과 과거 점수를 실제 앱에서 보존한다", async ({ previewRun }) => {
    test.setTimeout(300_000);
    const plan = readPlan();
    expect(previewRun.origin).toBe(plan.origin);
    const student = await previewRun.createStudent("m10-learning");
    const assigned = assignmentId(await assignSingleRange(previewRun.adminPage, student, {
      datasetId: plan.datasetId, questionCount: 4, rangeMode: "all", scheduleEnabled: false, timeLimit: "none",
    }), student.id);
    const page = await previewRun.openStudent(student);
    await page.locator(`article[data-assignment-id="${assigned}"]`).getByRole("link", { name: "단어 보기", exact: true }).click();
    await expect(page.getByRole("list", { name: "배정된 시험의 학습 단어" }).getByRole("listitem")).toHaveCount(4);
    await page.getByRole("button", { name: "뜻 가리기", exact: true }).click();
    await startLocalAssignment(page, assigned);
    const initial = await finishLocalPhase(page, [0, 1]);
    expect(initial.result).toMatchObject({ state: "retry_waiting", finalized: false, attempt: { initialScore: 50 } });
    expect(initial.retryTargets).toHaveLength(2);
    await startLocalRetry(page);
    const retry = await finishLocalPhase(page, [0]);
    expect(retry.result).toMatchObject({ state: "failed", finalized: true, attempt: { initialScore: 50, finalScore: 75, passed: false, unresolvedWrongCount: 1 } });
    const attemptId = (await readLocalRun(page)).plan!.attemptId;
    await page.getByRole("link", { name: "결과 보기", exact: true }).click();
    await expect(page.getByRole("region", { name: "시험 기록" })).toContainText("50점 · 미통과");
    await expect(page.getByRole("region", { name: "시험 기록" })).toContainText("75점 · 미통과");
    await expect(page.getByRole("region", { name: "다시 볼 단어", exact: true }).getByRole("article")).toHaveCount(1);
    await page.goto("/student/wordbook?view=current");
    await expect(page.getByRole("list", { name: "내 단어장" }).getByRole("listitem")).toHaveCount(1);
    await expect(page.getByText("1개 단어 · 현재 오답 2회", { exact: true })).toBeVisible();
    const reviewAssignment = assignmentId(await assignDirectReview(previewRun.adminPage, student), student.id, true);
    await startLocalAssignment(page, reviewAssignment);
    const solved = await finishLocalPhase(page);
    expect(solved.result).toMatchObject({ finalized: true, attempt: { finalScore: 100, passed: true, unresolvedWrongCount: 0 } });
    await page.goto("/student/wordbook?view=current");
    await expect(page.getByText("0개 단어 · 현재 오답 0회", { exact: true })).toBeVisible();
    await expect(page.getByText("조건에 맞는 단어가 없습니다.", { exact: true })).toBeVisible();
    await page.getByRole("tab", { name: "과거 이력", exact: true }).click();
    await expect(page.getByRole("list", { name: "내 단어장" }).getByRole("listitem")).toHaveCount(2);
    await page.goto(`/student/result/${attemptId}`);
    await expect(page.getByRole("region", { name: "시험 기록" })).toContainText("75점 · 미통과");
    await previewRun.adminPage.goto(`/admin/results/attempt.${attemptId}`);
    await expect(previewRun.adminPage.getByRole("region", { name: "시험 기록" })).toContainText("75점 · 미통과");
    await page.screenshot({ path: test.info().outputPath("학생_결과_PC.png") });
    await page.setViewportSize({ width: 390, height: 844 });
    await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.screenshot({ path: test.info().outputPath("학생_결과_모바일.png") });
    report("학습과오답", { studentId: student.id, assignmentId: assigned, attemptId, reviewAssignment, scores: [50, 75, 100], remainingMistakes: 0, priorHistoryPreserved: true });
  });

  test("미접수 답을 같은 주소 B→A→B와 늦은 제출·응답 유실 뒤에도 보존한다", async ({ previewRun }) => {
    test.setTimeout(420_000);
    const plan = readPlan();
    expect(previewRun.origin).toBe(plan.origin);
    const student = await previewRun.createStudent("m10-deploy-resume");
    const assigned = assignmentId(await assignSingleRange(previewRun.adminPage, student, {
      datasetId: plan.datasetId, questionCount: 4, rangeMode: "all", scheduleEnabled: false, timeLimit: "total", totalMinutes: 0.5,
    }), student.id);
    const page = await previewRun.openStudent(student, { width: 390, height: 844 });
    const run = await startLocalAssignment(page, assigned);
    const quizUrl = page.url();
    expect(await activeScreenBuild(page)).toBe(plan.b.build);
    const stopFaults = previewRun.allowQuizNetworkFaults();
    try {
    await page.context().setOffline(true);
    await chooseLocalAnswer(page, true);
    await page.reload({ waitUntil: "domcontentloaded" });
    await expect(page.locator("#quiz-prompt")).toBeVisible();
    expect((await readLocalRun(page)).answers).toHaveLength(1);
    for (let i = 1; i < 4; i += 1) await chooseLocalAnswer(page, true);
    await expect(page.getByRole("button", { name: "다시 확인", exact: true })).toBeVisible();
    const pending = await readLocalRun(page);
    expect(pending.receipt).toBeNull();
    expect(pending.batch?.answers).toHaveLength(4);
    const fingerprint = answerFingerprint(pending);
      expect(pending.plan!.limitMs).toBe(30_000);
      expect(pending.batch!.completion.elapsedMs).toBeLessThanOrEqual(pending.plan!.limitMs!);
      const deadline = Date.parse(pending.plan!.startedAt) + pending.plan!.limitMs!;
      switchAlias("a");
      await previewRun.verifyCurrentDeployment({ deploymentOrigin: plan.a.origin, targetDeploymentSha: plan.a.sha });
      await page.reload({ waitUntil: "domcontentloaded" });
      expect(await activeScreenBuild(page)).toBe(plan.b.build);
      expect(answerFingerprint(await readLocalRun(page))).toBe(fingerprint);
      // Leave the worker's scope without deleting any browser data before update.
      await page.goto("about:blank");
      await page.context().setOffline(false);
      await page.goto("/student");
      await page.evaluate(async () => { await (await navigator.serviceWorker.getRegistration("/quiz-offline"))!.update(); });
      await expect.poll(() => activeScreenBuild(page), { timeout: 30_000 }).toBe(plan.a.build);
      expect(answerFingerprint(await readLocalRun(page, run.key))).toBe(fingerprint);
      let serverTime = 0;
      await expect.poll(async () => {
        const response = await previewRun.adminContext.request.get("/api/preview-identity");
        expect(response.status()).toBe(200);
        serverTime = Date.parse(response.headers().date ?? "");
        return serverTime;
      }, { timeout: 45_000, intervals: [1000, 2000] }).toBeGreaterThan(deadline);
      let lostReceipt: unknown = null;
      let lostOnce = false;
      const submissions: string[] = [];
      await page.route("**/api/student/local-quiz", async route => {
        const body = route.request().postDataJSON();
        if (body?.action !== "submit") return route.continue();
        submissions.push(body.batch.submissionId);
        if (!lostOnce) {
          lostOnce = true;
          const response = await route.fetch();
          expect(response.status()).toBe(200);
          lostReceipt = await response.json();
          await route.abort("failed");
        } else await route.continue();
      });
      await page.goto(quizUrl);
      expect(await activeScreenBuild(page)).toBe(plan.a.build);
      await expect(page.getByRole("button", { name: "다시 확인", exact: true })).toBeVisible();
      const lost = await readLocalRun(page);
      expect(lost.receipt).toBeNull();
      expect(answerFingerprint(lost)).toBe(fingerprint);
      expect(lostReceipt).not.toBeNull();
      expect(submissions).toHaveLength(1);
      await previewRun.verifyCurrentDeployment({ deploymentOrigin: plan.a.origin, targetDeploymentSha: plan.a.sha });
      // A really accepted this saved answer batch. B must acknowledge the same receipt.
      await page.goto("/student");
      switchAlias("b");
      await previewRun.verifyCurrentDeployment({ deploymentOrigin: plan.b.origin, targetDeploymentSha: plan.b.sha });
      await page.evaluate(async () => { await (await navigator.serviceWorker.getRegistration("/quiz-offline"))!.update(); });
      await expect.poll(() => activeScreenBuild(page), { timeout: 30_000 }).toBe(plan.b.build);
      expect(answerFingerprint(await readLocalRun(page, run.key))).toBe(fingerprint);
      await page.goto(quizUrl);
      expect(await activeScreenBuild(page)).toBe(plan.b.build);
      await expect(page.getByText("시험 결과가 저장됐습니다.", { exact: true })).toBeVisible();
      const final = await readLocalRun(page);
      expect(final.receipt).toEqual(lostReceipt);
      expect(final.receipt?.result).toMatchObject({ finalized: true, attempt: { finalScore: 100, passed: true } });
      expect(submissions).toHaveLength(2);
      expect(new Set(submissions).size).toBe(1);
      await page.screenshot({ path: test.info().outputPath("배포복귀_답접수.png") });
      report("같은주소_복귀", { studentId: student.id, assignmentId: assigned, attemptId: run.plan!.attemptId,
        sequence: [plan.b.id, plan.a.id, plan.b.id], builds: [plan.b.build, plan.a.build, plan.b.build],
        fingerprint, answerCount: final.answers.length, submissionId: final.batch?.submissionId, actualPosts: submissions.length,
        deadline: new Date(deadline).toISOString(), serverTimeBeforeFirstSubmit: new Date(serverTime).toISOString(),
        acceptedBy: plan.a.id, replayedBy: plan.b.id,
        responseReplayIdentical: true, receipt: final.receipt });
    } finally {
      try {
        await page.goto("about:blank").catch(() => undefined);
        await page.context().setOffline(false);
      } finally {
        stopFaults();
        switchAlias("b");
        await previewRun.verifyCurrentDeployment({ deploymentOrigin: plan.b.origin, targetDeploymentSha: plan.b.sha });
      }
    }
  });
});
