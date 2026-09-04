import { expect, type Page } from "@playwright/test";

import type { PreviewStudent } from "../fixtures/preview-run";

type AssignmentPlan = {
  datasetId?: string;
  direction?: "english_to_korean" | "korean_to_english" | "mixed";
  perQuestionSeconds?: number;
  questionCount?: number;
  questionMode?:
    | "book_meaning_choice"
    | "canonical_definition_to_headword"
    | "canonical_example_to_headword";
  rangeMode?: "all" | "first-unit" | "second-unit" | "two-units";
  scheduleEnabled?: boolean;
  timeLimit?: "none" | "per-question";
};

async function chooseDataset(page: Page, datasetId?: string) {
  const select = page.locator('select[data-field-key="dataset"]');
  await expect(select).toBeVisible();
  if (datasetId) {
    await expect(select.locator(`option[value="${datasetId}"]`)).toHaveCount(1);
    await select.selectOption(datasetId);
    await expect(select).toHaveValue(datasetId);
    return;
  }
  const value = await select.inputValue();
  if (value) return;
  const firstValue = await select.locator("option:not([disabled])").evaluateAll(
    (options) => options.map((option) => (option as HTMLOptionElement).value).find(Boolean),
  );
  if (!firstValue) throw new Error("Preview에 배정 가능한 단어장이 없습니다.");
  await select.selectOption(firstValue);
}

async function chooseQuestionMode(
  page: Page,
  mode: AssignmentPlan["questionMode"],
) {
  if (!mode || mode === "book_meaning_choice") return;
  const label = mode === "canonical_definition_to_headword"
    ? "영영풀이 → 영어"
    : "예문 → 영어";
  const tabs = page.getByRole("tablist", { name: "출제 자료" });
  await expect(tabs.getByRole("tab")).toHaveCount(3);
  const tab = tabs.getByRole("tab", { name: label, exact: true });
  await tab.click();
  await expect(tab).toHaveAttribute("aria-selected", "true");
  await expect(
    page.getByText("검수된 영어 선택지 4개로 바로 배정하는 Preview 전용 유형입니다."),
  ).toBeVisible();
}

async function chooseRange(page: Page, mode: AssignmentPlan["rangeMode"]) {
  const group = page.getByRole("group", { name: "시험 범위 선택" });
  await expect(group).toBeVisible();
  const unitRail = group.getByRole("group", { name: "단어 범위" });
  await expect(unitRail.getByRole("button").first()).toBeVisible();
  if (mode === "first-unit" || mode === "second-unit") {
    const units = unitRail.getByRole("button");
    const index = mode === "first-unit" ? 0 : 1;
    expect(await units.count()).toBeGreaterThan(index);
    await units.nth(index).click();
    await page.getByRole("button", { name: "단어 수", exact: true }).click();
    await page.getByRole("spinbutton", { name: "회차당 단어 수" }).fill("4");
    return;
  }
  if (mode === "two-units") {
    const units = unitRail.getByRole("button");
    expect(await units.count()).toBeGreaterThanOrEqual(2);
    await units.nth(0).click();
    await units.nth(1).click();
    await page.getByRole("button", { name: "회차별", exact: true }).click();
    return;
  }
  await group.getByRole("button", { name: "전체 선택", exact: true }).click();
  await page.getByRole("button", { name: "단어 수", exact: true }).click();
  const count = page.getByRole("spinbutton", { name: "회차당 단어 수" });
  await count.fill(String(4));
}

async function setCheckbox(page: Page, fieldKey: string, checked: boolean) {
  const checkbox = page.locator(`[data-field-key="${fieldKey}"] input[type="checkbox"]`);
  await expect(checkbox).toHaveCount(1);
  if ((await checkbox.isChecked()) !== checked) await checkbox.click();
}

async function configureSchedule(page: Page, enabled: boolean) {
  const label = page.getByText("시험일 사용", { exact: true });
  const checkbox = label.locator("xpath=../label/input[@type='checkbox']");
  await expect(checkbox).toHaveCount(1);
  if ((await checkbox.isChecked()) !== enabled) await checkbox.click();
  if (!enabled) return;

  const startDate = await page
    .locator('input[data-field-key="startDate"]')
    .inputValue();
  const parsed = new Date(`${startDate}T00:00:00Z`);
  if (Number.isNaN(parsed.getTime())) {
    throw new Error("배정 기준일을 확인하지 못했습니다.");
  }
  const firstWeekday = parsed.getUTCDay() === 0 ? 7 : parsed.getUTCDay();
  const secondWeekday = firstWeekday === 7 ? 1 : firstWeekday + 1;
  const weekdayLabels = ["월", "화", "수", "목", "금", "토", "일"];
  const weekdayGroup = page.getByRole("group", { name: "배정 요일" });
  for (const weekday of [firstWeekday, secondWeekday]) {
    const button = weekdayGroup.getByRole("button", {
      name: weekdayLabels[weekday - 1],
      exact: true,
    });
    if ((await button.getAttribute("aria-pressed")) !== "true") {
      await button.click();
    }
  }
}

async function configureRangeAssignment(page: Page, plan: AssignmentPlan = {}) {
  await chooseDataset(page, plan.datasetId);
  await chooseRange(page, plan.rangeMode ?? "all");
  await chooseQuestionMode(page, plan.questionMode);
  if (plan.direction) {
    const label = plan.direction === "english_to_korean"
      ? "영어 → 뜻"
      : plan.direction === "korean_to_english"
        ? "뜻 → 영어"
        : "혼합";
    await page
      .locator('[data-field-key="direction"]')
      .getByRole("button", { name: label, exact: true })
      .click();
  }
  if (plan.questionCount && plan.questionCount !== 4) {
    await page
      .getByRole("spinbutton", { name: "회차당 단어 수" })
      .fill(String(plan.questionCount));
  }
  if (plan.timeLimit === "per-question") {
    await setCheckbox(page, "timing", true);
    await page.getByRole("button", { name: "문제당", exact: true }).click();
    await page
      .getByRole("spinbutton", { name: "문제당 시간(초)" })
      .fill(String(plan.perQuestionSeconds ?? 5));
  } else {
    await setCheckbox(page, "timing", false);
  }
  await configureSchedule(page, plan.scheduleEnabled ?? false);

  const preview = page.getByRole("region", { name: "배정 미리보기" });
  await expect(preview).toBeVisible();
  await expect(preview).toHaveAttribute("aria-busy", "false", {
    timeout: 30_000,
  });
  await expect(preview.getByRole("status")).toHaveCount(0);
}

async function waitForAssignmentSave(page: Page, endpoint: RegExp) {
  const responsePromise = page.waitForResponse(
    (response) =>
      response.request().method() === "POST" && endpoint.test(response.url()),
    { timeout: 60_000 },
  );
  await page.getByRole("button", { name: "배정하기", exact: true }).click();
  const response = await responsePromise;
  const responseText = await response.text();
  expect(response.status(), responseText).toBeGreaterThanOrEqual(200);
  expect(response.status()).toBeLessThan(300);
  await expect(page.getByRole("dialog")).toHaveCount(0);
  return JSON.parse(responseText) as unknown;
}

export async function openSingleAssignment(page: Page, student: PreviewStudent) {
  await page.goto("/admin/assignments");
  await page
    .getByRole("searchbox", { name: "학생 및 학습 자료 검색" })
    .fill(student.displayName);
  const studentCard = page
    .getByRole("article")
    .filter({ hasText: student.displayName });
  await expect(studentCard).toHaveCount(1);
  await studentCard
    .getByRole("button", { name: "단어 배정", exact: true })
    .click();
  await expect(page.getByRole("dialog", { name: "단일 배정" })).toBeVisible();
}

export async function assignSingleRange(
  page: Page,
  student: PreviewStudent,
  plan: AssignmentPlan = {},
) {
  await openSingleAssignment(page, student);
  await configureRangeAssignment(page, plan);
  return waitForAssignmentSave(page, /\/api\/admin\/bulk-assignments$/);
}

export async function assignCanonicalRange(
  page: Page,
  student: PreviewStudent,
  input: {
    datasetId: string;
    perQuestionSeconds?: number;
    questionMode:
      | "canonical_definition_to_headword"
      | "canonical_example_to_headword";
  },
) {
  await openSingleAssignment(page, student);
  await configureRangeAssignment(page, {
    datasetId: input.datasetId,
    perQuestionSeconds: input.perQuestionSeconds ?? 5,
    questionCount: 4,
    questionMode: input.questionMode,
    rangeMode: "first-unit",
    scheduleEnabled: false,
    timeLimit: "per-question",
  });
  const directionButtons = page.locator('[data-field-key="direction"] button');
  await expect(directionButtons).toHaveCount(3);
  for (let index = 0; index < 3; index += 1) {
    await expect(directionButtons.nth(index)).toBeDisabled();
  }
  await expect(
    directionButtons.filter({ hasText: "뜻 → 영어" }),
  ).toHaveAttribute("aria-pressed", "true");
  const scheduleCheckbox = page
    .getByText("시험일 사용", { exact: true })
    .locator("xpath=../label/input[@type='checkbox']");
  await expect(scheduleCheckbox).toBeDisabled();
  await expect(scheduleCheckbox).not.toBeChecked();

  const response = await waitForAssignmentSave(
    page,
    /\/api\/admin\/bulk-assignments$/,
  ) as {
    assignments?: Array<{
      assignment_id?: string | null;
      status?: string;
      student_id?: string;
    }>;
  };
  const assigned = response.assignments?.find(
    (item) => item.student_id === student.id && item.status === "assigned",
  );
  if (!assigned?.assignment_id) {
    throw new Error("canonical Preview 배정 ID를 저장 응답에서 찾지 못했습니다.");
  }
  return assigned.assignment_id;
}

export async function assignBulkRange(
  page: Page,
  students: readonly PreviewStudent[],
  plan: AssignmentPlan = {},
) {
  await page.goto("/admin/assignments");
  await page.getByRole("tab", { name: "일괄 배정" }).click();
  for (const student of students) {
    await page
      .getByRole("searchbox", { name: "학생 및 학습 자료 검색" })
      .fill(student.displayName);
    const checkbox = page.getByRole("checkbox", {
      name: `${student.displayName} 일괄 배정 선택`,
    });
    await expect(checkbox).toBeVisible();
    await checkbox.check();
  }
  await page
    .getByRole("searchbox", { name: "학생 및 학습 자료 검색" })
    .fill("");
  await page.getByRole("button", { name: "단어 배정", exact: true }).click();
  await expect(page.getByRole("dialog", { name: "일괄 배정" })).toBeVisible();
  await configureRangeAssignment(page, plan);
  return waitForAssignmentSave(page, /\/api\/admin\/bulk-assignments$/);
}

export async function assignDirectReview(page: Page, student: PreviewStudent) {
  await openSingleAssignment(page, student);
  await page.getByRole("tab", { name: "오답 시험" }).click();
  const calculation = page.locator('[data-field-key="questionCount"]');
  await expect(calculation).not.toHaveAttribute("data-status", /idle|loading/);
  const datasetButtons = page.locator('[data-field-key="dataset"] button:not([disabled])');
  await expect(datasetButtons.first()).toBeVisible();
  await datasetButtons.first().click();
  const levelButtons = page.locator('[data-field-key="reviewLevels"] button:not([disabled])');
  const levelCount = await levelButtons.count();
  for (let index = 0; index < levelCount; index += 1) {
    const button = levelButtons.nth(index);
    if ((await button.getAttribute("aria-pressed")) !== "true") await button.click();
  }
  await setCheckbox(page, "timing", true);
  await page.getByRole("button", { name: "문제당", exact: true }).click();
  await page.getByRole("spinbutton", { name: "문제당 시간(초)" }).fill("5");
  return waitForAssignmentSave(page, /\/api\/admin\/exact-review-assignments$/);
}

export async function startLatestAssignment(
  page: Page,
  options: { review?: boolean } = {},
) {
  await page.goto("/student");
  let cards = page.locator('article[data-assignment-id]').filter({
    has: page.getByRole("button", { name: "시험 시작" }),
  });
  if (options.review) cards = cards.filter({ hasText: "오답 시험" });
  const card = cards.first();
  await expect(card).toBeVisible();
  const assignmentId = await card.getAttribute("data-assignment-id");
  if (!assignmentId) throw new Error("학생 시험 카드의 assignment ID가 없습니다.");
  await Promise.all([
    page.waitForURL(/\/student\/attempt\/[0-9a-f-]+$/),
    card.getByRole("button", { name: "시험 시작" }).click(),
  ]);
  await expect(page.locator("#quiz-prompt")).toBeVisible();
  return assignmentId;
}

export async function startAssignmentById(page: Page, assignmentId: string) {
  await page.goto("/student");
  const card = page.locator(
    `article[data-assignment-id="${assignmentId}"]`,
  );
  await expect(card).toHaveCount(1);
  await expect(card.getByRole("button", { name: "시험 시작" })).toBeVisible();
  await Promise.all([
    page.waitForURL(/\/student\/attempt\/[0-9a-f-]+$/),
    card.getByRole("button", { name: "시험 시작" }).click(),
  ]);
  await expect(page.locator("#quiz-prompt")).toBeVisible();
}

async function currentQuestionId(page: Page) {
  const questionId = await page.locator("#quiz-prompt").getAttribute("data-question-id");
  if (!questionId) throw new Error("현재 시험 문항 ID가 없습니다.");
  return questionId;
}

async function waitForQuizTransition(page: Page, questionId: string) {
  await page.waitForFunction(
    (previousQuestionId) =>
      window.location.pathname.includes("/student/result/") ||
      document.querySelector("#quiz-prompt")?.getAttribute("data-question-id") !==
        previousQuestionId,
    questionId,
    { timeout: 10_000 },
  );
}

export async function finishPhaseByTimeout(
  page: Page,
): Promise<Map<string, number>> {
  const correctChoices = new Map<string, number>();
  for (let guard = 0; guard < 500; guard += 1) {
    if (new URL(page.url()).pathname.includes("/student/result/")) return correctChoices;
    const questionId = await currentQuestionId(page);
    const response = await page.waitForResponse(
      (candidate) =>
        candidate.request().method() === "POST" &&
        /\/api\/student\/attempts\/[0-9a-f-]+\/timeouts$/.test(candidate.url()),
      { timeout: 12_000 },
    );
    const payload = (await response.json()) as { correctChoiceIndex?: number };
    if (typeof payload.correctChoiceIndex !== "number") {
      throw new Error("시간초과 응답에서 정답 위치를 받지 못했습니다.");
    }
    correctChoices.set(questionId, payload.correctChoiceIndex);
    await waitForQuizTransition(page, questionId);
  }
  throw new Error("시험 문항 수 안전 한도를 초과했습니다.");
}

export async function finishRetry(
  page: Page,
  correctChoices: ReadonlyMap<string, number>,
  answer: "correct" | "wrong",
) {
  await page.getByRole("button", { name: "재시험 시작" }).click();
  await page.waitForURL(/\/student\/attempt\/[0-9a-f-]+$/);
  for (let guard = 0; guard < 500; guard += 1) {
    if (new URL(page.url()).pathname.includes("/student/result/")) return;
    const questionId = await currentQuestionId(page);
    const correctIndex = correctChoices.get(questionId);
    if (correctIndex === undefined) {
      throw new Error(`재시험 문항 ${questionId}의 정답 위치를 찾지 못했습니다.`);
    }
    const selectedIndex = answer === "correct" ? correctIndex : (correctIndex + 1) % 4;
    const responsePromise = page.waitForResponse(
      (candidate) =>
        candidate.request().method() === "POST" &&
        /\/api\/student\/attempts\/[0-9a-f-]+\/answers$/.test(candidate.url()),
    );
    await page.locator('button[data-feedback="idle"]').nth(selectedIndex).click();
    const response = await responsePromise;
    expect(response.status()).toBe(200);
    await waitForQuizTransition(page, questionId);
  }
  throw new Error("재시험 문항 수 안전 한도를 초과했습니다.");
}

export async function finishRetryKeepingOneWrong(
  page: Page,
  correctChoices: ReadonlyMap<string, number>,
) {
  await page.getByRole("button", { name: "재시험 시작" }).click();
  await page.waitForURL(/\/student\/attempt\/[0-9a-f-]+$/);
  let answered = 0;
  for (let guard = 0; guard < 500; guard += 1) {
    if (new URL(page.url()).pathname.includes("/student/result/")) {
      return { correct: Math.max(0, answered - 1), total: answered, wrong: 1 };
    }
    const questionId = await currentQuestionId(page);
    const correctIndex = correctChoices.get(questionId);
    if (correctIndex === undefined) {
      throw new Error(`재시험 문항 ${questionId}의 정답 위치를 찾지 못했습니다.`);
    }
    const shouldBeWrong = answered === 0;
    const selectedIndex = shouldBeWrong
      ? (correctIndex + 1) % 4
      : correctIndex;
    const choices = page.locator("button[data-feedback]");
    await expect(choices).toHaveCount(4);
    const selected = choices.nth(selectedIndex);
    const responsePromise = page.waitForResponse(
      (candidate) =>
        candidate.request().method() === "POST" &&
        /\/api\/student\/attempts\/[0-9a-f-]+\/answers$/.test(candidate.url()),
    );
    await selected.click();
    const response = await responsePromise;
    expect(response.status()).toBe(200);
    const payload = (await response.json()) as { correct?: boolean };
    expect(payload.correct).toBe(!shouldBeWrong);
    await expect(selected).toHaveAttribute(
      "data-feedback",
      shouldBeWrong ? "wrong" : "correct",
    );
    answered += 1;
    await waitForQuizTransition(page, questionId);
  }
  throw new Error("재시험 문항 수 안전 한도를 초과했습니다.");
}

export async function finishInitialChoosingFirst(page: Page) {
  const correctChoices = new Map<string, number>();
  for (let guard = 0; guard < 500; guard += 1) {
    if (new URL(page.url()).pathname.includes("/student/result/")) {
      await expect(page.locator('main a[href="/student"]').first()).toBeVisible();
      const retry = page.getByRole("button", { name: "재시험 시작" });
      if (await retry.isVisible()) {
        await finishRetry(page, correctChoices, "correct");
      }
      return;
    }
    const questionId = await currentQuestionId(page);
    const responsePromise = page.waitForResponse(
      (candidate) =>
        candidate.request().method() === "POST" &&
        /\/api\/student\/attempts\/[0-9a-f-]+\/answers$/.test(candidate.url()),
    );
    await page.locator('button[data-feedback="idle"]').first().click();
    const response = await responsePromise;
    expect(response.status()).toBe(200);
    const payload = (await response.json()) as { correctChoiceIndex?: number };
    if (typeof payload.correctChoiceIndex !== "number") {
      throw new Error("답안 응답에서 정답 위치를 받지 못했습니다.");
    }
    correctChoices.set(questionId, payload.correctChoiceIndex);
    await waitForQuizTransition(page, questionId);
  }
  throw new Error("시험 문항 수 안전 한도를 초과했습니다.");
}
