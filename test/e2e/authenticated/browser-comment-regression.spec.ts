import { expect, test } from "../fixtures/preview-run";
import {
  assignSingleRange,
  openSingleAssignment,
  startAssignmentById,
} from "../support/vocab-journey";

const simseokDatasetId = "d5b0a7e9-ea28-47de-94cf-c06b640ae995";

test.describe.serial("@authenticated 브라우저 지적 회귀", () => {
  test("관리자 780px 회차별 마감 열과 글자 크기를 유지한다", async ({
    previewRun,
  }) => {
    const student = await previewRun.createStudent("admin-session-layout");
    const page = previewRun.adminPage;
    await page.setViewportSize({ width: 780, height: 986 });
    await openSingleAssignment(page, student);

    const dataset = page.locator('select[data-field-key="dataset"]');
    await expect(dataset).toBeVisible();
    await dataset.selectOption(simseokDatasetId);
    await page
      .getByRole("group", { name: "단어 범위" })
      .getByRole("button")
      .first()
      .click();
    await page.getByRole("button", { name: "단어 수", exact: true }).click();
    await page
      .getByRole("spinbutton", { name: "회차당 단어 수" })
      .fill("3");
    const weekdays = page.getByRole("group", { name: "배정 요일" });
    for (const day of ["월", "화", "수", "목"]) {
      await weekdays.getByRole("button", { name: day, exact: true }).click();
    }

    const rows = page.locator('div[class*="sessionTimeRow"]');
    await expect(rows).toHaveCount(4);
    await expect(page.getByText("완료 후 생성", { exact: true })).toHaveCount(3);
    const rowMetrics = await rows.evaluateAll((elements) =>
      elements.map((element) => {
        const identity = element.querySelector('[class*="sessionTimeIdentity"]');
        const deadline = element.querySelector('[class*="sessionDeadlineField"]');
        const input = deadline?.querySelector("input");
        const inputRect = input?.getBoundingClientRect();
        return {
          deadlineWidth: inputRect?.width ?? 0,
          deadlineX: inputRect?.x ?? 0,
          identityWidth: identity?.getBoundingClientRect().width ?? 0,
          identityX: identity?.getBoundingClientRect().x ?? 0,
        };
      }),
    );
    expect(new Set(rowMetrics.map((metric) => metric.deadlineX.toFixed(1))).size).toBe(1);
    expect(
      new Set(rowMetrics.map((metric) => metric.deadlineWidth.toFixed(1))).size,
    ).toBe(1);
    expect(new Set(rowMetrics.map((metric) => metric.identityX.toFixed(1))).size).toBe(1);
    expect(
      new Set(rowMetrics.map((metric) => metric.identityWidth.toFixed(1))).size,
    ).toBe(1);

    const dialogMetrics = await page.getByRole("dialog").evaluate((dialog) => {
      const visibleTextElements = [...dialog.querySelectorAll("button, label, strong")]
        .filter((element) => {
          const rect = element.getBoundingClientRect();
          return rect.width > 0 && rect.height > 0 && element.textContent?.trim();
        });
      return {
        minimumTextSize: Math.min(
          ...visibleTextElements.map((element) =>
            Number.parseFloat(getComputedStyle(element).fontSize)
          ),
        ),
        overflow: dialog.scrollWidth - dialog.clientWidth,
      };
    });
    expect(dialogMetrics.minimumTextSize).toBeGreaterThanOrEqual(14);
    expect(dialogMetrics.overflow).toBeLessThanOrEqual(1);
    await page.getByRole("button", { name: "닫기", exact: true }).click();
  });

  test("영어 음성이 끝난 뒤에만 다음 문제로 이동하고 피드백은 먼저 보인다", async ({
    previewRun,
  }) => {
    const student = await previewRun.createStudent("prompt-audio-feedback");
    const assignmentId = await assignSingleRange(previewRun.adminPage, student, {
      datasetId: simseokDatasetId,
      direction: "english_to_korean",
      questionCount: 4,
      rangeMode: "first-unit",
      scheduleEnabled: false,
      timeLimit: "none",
    });
    const assigned = assignmentId as {
      assignments?: Array<{ assignment_id?: string; student_id?: string }>;
    };
    const exactAssignmentId = assigned.assignments?.find(
      (candidate) => candidate.student_id === student.id,
    )?.assignment_id;
    expect(exactAssignmentId).toMatch(/^[0-9a-f-]{36}$/);

    const studentPage = await previewRun.openStudent(student);
    await studentPage.setViewportSize({ width: 467, height: 986 });
    await studentPage.addInitScript(() => {
      const browserWindow = window as typeof window & {
        __quizAudioEvents?: Array<{ at: number; src: string; type: string }>;
      };
      browserWindow.__quizAudioEvents = [];
      HTMLMediaElement.prototype.play = function controlledPlay() {
        const src = this.currentSrc || this.src;
        browserWindow.__quizAudioEvents?.push({
          at: performance.now(),
          src,
          type: "play",
        });
        window.setTimeout(() => {
          browserWindow.__quizAudioEvents?.push({
            at: performance.now(),
            src,
            type: "ended",
          });
          this.dispatchEvent(new Event("ended"));
        }, 2_500);
        return Promise.resolve();
      };
    });
    await startAssignmentById(studentPage, exactAssignmentId!);

    const attemptId = new URL(studentPage.url()).pathname.split("/").at(-1)!;
    const attemptResponse = await studentPage.request.get(
      "/api/student/attempts/" + attemptId,
    );
    expect(attemptResponse.status()).toBe(200);
    const attemptPayload = (await attemptResponse.json()) as {
      attempt?: {
        currentQuestionId?: string;
        questions?: Array<{
          id: string;
          pronunciation: { audioUrl: string | null; available: boolean };
        }>;
      };
    };
    const firstQuestion = attemptPayload.attempt?.questions?.find(
      (question) => question.id === attemptPayload.attempt?.currentQuestionId,
    );
    expect(firstQuestion?.pronunciation.available).toBe(true);
    expect(firstQuestion?.pronunciation.audioUrl).toMatch(/^https:\/\//);
    const audioResponse = await studentPage.request.get(
      firstQuestion!.pronunciation.audioUrl!,
    );
    expect(audioResponse.status()).toBe(200);
    expect(audioResponse.headers()["content-type"]).toContain("audio/mpeg");

    await expect.poll(() =>
      studentPage.evaluate(() =>
        (window as typeof window & {
          __quizAudioEvents?: Array<{ type: string }>;
        }).__quizAudioEvents?.filter((event) => event.type === "play").length ?? 0
      )
    ).toBeGreaterThan(0);
    const questionId = await studentPage
      .locator("#quiz-prompt")
      .getAttribute("data-question-id");
    const selected = studentPage.locator('button[data-feedback="idle"]').first();
    const responsePromise = studentPage.waitForResponse(
      (response) =>
        response.request().method() === "POST" &&
        /\/api\/student\/attempts\/[0-9a-f-]+\/answers$/.test(response.url()),
    );
    await selected.click();
    const answerResponse = await responsePromise;
    expect(answerResponse.status()).toBe(200);
    const responseReceivedAt = Date.now();
    await expect(selected).toHaveAttribute("data-feedback", /correct|wrong/, {
      timeout: 700,
    });
    expect(Date.now() - responseReceivedAt).toBeLessThan(700);

    await studentPage.waitForTimeout(200);
    await expect(studentPage.locator("#quiz-prompt")).toHaveAttribute(
      "data-question-id",
      questionId!,
    );
    const endedAt = await expect.poll(() =>
      studentPage.evaluate(() => {
        const events = (window as typeof window & {
          __quizAudioEvents?: Array<{ at: number; type: string }>;
        }).__quizAudioEvents ?? [];
        return events.find((event) => event.type === "ended")?.at ?? 0;
      })
    ).toBeGreaterThan(0);
    void endedAt;
    await studentPage.waitForFunction(
      (previousQuestionId) =>
        document.querySelector("#quiz-prompt")?.getAttribute("data-question-id") !==
        previousQuestionId,
      questionId,
      { timeout: 5_000 },
    );
    const transitionAt = await studentPage.evaluate(() => performance.now());
    const recordedEndedAt = await studentPage.evaluate(() => {
      const events = (window as typeof window & {
        __quizAudioEvents?: Array<{ at: number; type: string }>;
      }).__quizAudioEvents ?? [];
      return events.find((event) => event.type === "ended")?.at ?? 0;
    });
    expect(transitionAt - recordedEndedAt).toBeGreaterThanOrEqual(100);
    expect(transitionAt - recordedEndedAt).toBeLessThan(800);
  });
});
