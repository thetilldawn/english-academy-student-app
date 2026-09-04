import { expect, test } from "../fixtures/preview-run";
import {
  assignCanonicalRange,
  finishPhaseByTimeout,
  finishRetryKeepingOneWrong,
  startAssignmentById,
} from "../support/vocab-journey";

const canonicalDatasetId = "d5b0a7e9-ea28-47de-94cf-c06b640ae995";

const scenarios = [
  {
    caseName: "canonical-definition",
    label: "영영풀이 → 영어",
    mode: "canonical_definition_to_headword",
  },
  {
    caseName: "canonical-example",
    label: "예문 → 영어",
    mode: "canonical_example_to_headword",
  },
] as const;

type AttemptQuestion = {
  choices: string[];
  choicePronunciations: Array<{
    audioUrl: string | null;
    available: boolean;
  }>;
  direction: "english_to_korean" | "korean_to_english";
  id: string;
  prompt: string;
};

for (const scenario of scenarios) {
  test(`@authenticated @canonical ${scenario.label} 배정·응시·재시험·결과`, async ({
    previewRun,
  }) => {
    const student = await previewRun.createStudent(scenario.caseName);
    const assignmentId = await assignCanonicalRange(
      previewRun.adminPage,
      student,
      {
        datasetId: canonicalDatasetId,
        perQuestionSeconds: 8,
        questionMode: scenario.mode,
      },
    );
    const studentPage = await previewRun.openStudent(student);
    await studentPage.setViewportSize({ width: 467, height: 986 });
    await studentPage.addInitScript(() => {
      const browserWindow = window as typeof window & {
        __quizAudioPlayCalls?: string[];
      };
      browserWindow.__quizAudioPlayCalls = [];
      const originalPlay = HTMLMediaElement.prototype.play;
      HTMLMediaElement.prototype.play = function patchedPlay() {
        browserWindow.__quizAudioPlayCalls?.push(this.currentSrc || this.src);
        return originalPlay.call(this);
      };
    });
    await startAssignmentById(studentPage, assignmentId);
    const attemptId = new URL(studentPage.url()).pathname.split("/").at(-1);
    expect(attemptId).toMatch(/^[0-9a-f-]{36}$/);

    const attemptResponse = await studentPage.request.get(
      `/api/student/attempts/${attemptId}`,
    );
    const attemptText = await attemptResponse.text();
    expect(attemptResponse.status(), attemptText).toBe(200);
    const attemptPayload = JSON.parse(attemptText) as {
      attempt?: {
        questions?: AttemptQuestion[];
        quizContentMode?: string;
      };
    };
    expect(attemptPayload.attempt?.quizContentMode).toBe(scenario.mode);
    const questions = attemptPayload.attempt?.questions ?? [];
    expect(questions).toHaveLength(4);
    expect(questions.every((question) =>
      question.direction === "korean_to_english"
    )).toBe(true);

    const firstQuestion = questions[0];
    expect(firstQuestion).toBeDefined();
    expect(firstQuestion!.choicePronunciations).toHaveLength(4);
    expect(
      firstQuestion!.choicePronunciations.every(
        (pronunciation) => pronunciation.available && pronunciation.audioUrl,
      ),
    ).toBe(true);
    await expect(studentPage.locator("#quiz-prompt > span").first()).toHaveText(
      firstQuestion!.prompt,
    );
    await expect(
      studentPage.locator("#quiz-prompt [data-pronunciation-text]"),
    ).toHaveCount(0);
    const visibleChoices = await studentPage
      .locator("button[data-feedback]")
      .evaluateAll((buttons) =>
        buttons.map((button) =>
          button
            .querySelector("span:nth-child(2) > span:first-child")
            ?.textContent?.trim() ?? ""
        )
    );
    expect(visibleChoices).toEqual(firstQuestion!.choices);
    const speakerButtons = firstQuestion!.choices.map((choice) =>
      studentPage.getByRole("button", {
        name: choice + " 발음 듣기",
        exact: true,
      })
    );
    for (const speakerButton of speakerButtons) {
      await expect(speakerButton).toBeVisible();
    }
    const firstQuestionId = await studentPage
      .locator("#quiz-prompt")
      .getAttribute("data-question-id");
    await speakerButtons[0].click();
    await expect.poll(() =>
      studentPage.evaluate(() =>
        (window as typeof window & { __quizAudioPlayCalls?: string[] })
          .__quizAudioPlayCalls ?? []
      )
    ).toContain(firstQuestion!.choicePronunciations[0]!.audioUrl);
    await expect(studentPage.locator("#quiz-prompt")).toHaveAttribute(
      "data-question-id",
      firstQuestionId!,
    );
    await expect(studentPage.locator('button[data-feedback="idle"]')).toHaveCount(4);

    const headerMetrics = await studentPage.evaluate(() => {
      const frame = document.querySelector("main section");
      const topline = frame?.firstElementChild as HTMLElement | null;
      const phase = topline?.querySelector("p") as HTMLElement | null;
      const title = topline?.querySelector("strong") as HTMLElement | null;
      const timer = topline?.querySelector('[data-testid="quiz-timer"]') as HTMLElement | null;
      const topRect = topline?.getBoundingClientRect();
      const timerRect = timer?.getBoundingClientRect();
      return {
        overflow: document.documentElement.scrollWidth - window.innerWidth,
        phaseFont: phase ? Number.parseFloat(getComputedStyle(phase).fontSize) : 0,
        timerCenterDelta: topRect && timerRect
          ? Math.abs(
              topRect.top + topRect.height / 2 -
                (timerRect.top + timerRect.height / 2),
            )
          : 999,
        timerFont: timer ? Number.parseFloat(getComputedStyle(timer).fontSize) : 0,
        timerLineHeight: timer ? Number.parseFloat(getComputedStyle(timer).lineHeight) : 0,
        titleFont: title ? Number.parseFloat(getComputedStyle(title).fontSize) : 0,
      };
    });
    expect(headerMetrics).toMatchObject({
      phaseFont: 16,
      timerFont: 24,
      timerLineHeight: 24,
      titleFont: 18,
    });
    expect(headerMetrics.timerCenterDelta).toBeLessThan(1);
    expect(headerMetrics.overflow).toBeLessThanOrEqual(1);

    const audioUrls = [
      ...new Set(
        firstQuestion!.choicePronunciations.map(
          (pronunciation) => pronunciation.audioUrl!,
        ),
      ),
    ];
    const audioResponses = await Promise.all(
      audioUrls.map((audioUrl) => studentPage.request.get(audioUrl)),
    );
    for (const response of audioResponses) {
      expect(response.status()).toBe(200);
      expect(response.headers()["content-type"]).toContain("audio/mpeg");
    }
    const blankCount = firstQuestion!.prompt.split("_____").length - 1;
    expect(blankCount).toBe(
      scenario.mode === "canonical_example_to_headword" ? 1 : 0,
    );

    const correctChoices = await finishPhaseByTimeout(studentPage);
    expect(correctChoices.size).toBe(4);
    await expect(
      studentPage.getByRole("button", { name: "재시험 시작" }),
    ).toBeVisible();
    for (const question of questions) {
      await expect(
        studentPage.getByText(question.prompt, { exact: true }).first(),
      ).toBeVisible();
    }

    const retry = await finishRetryKeepingOneWrong(
      studentPage,
      correctChoices,
    );
    expect(retry).toEqual({ correct: 3, total: 4, wrong: 1 });
    await expect(
      studentPage.getByText("재시험 후에도 다시 볼 단어가 남았습니다."),
    ).toBeVisible();
    await expect(
      studentPage.locator('section[aria-label="시험 결과 요약"] strong'),
    ).toHaveText(["0/4", "3", "1"]);
    for (const question of questions) {
      await expect(
        studentPage.getByText(question.prompt, { exact: true }).first(),
      ).toBeVisible();
    }
  });
}
