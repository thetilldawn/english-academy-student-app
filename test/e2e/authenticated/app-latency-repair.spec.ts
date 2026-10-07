import { test, expect } from "../fixtures/preview-run";
import { assignSingleRange, openSingleAssignment } from "../support/vocab-journey";
import { finishLocalPhase, startLocalAssignment, startLocalRetry } from "../support/local-quiz-journey";

test("@authenticated 구조 수리 후 배정·창 복귀·시험·내 단어장을 연결한다", async ({ previewRun }) => {
  test.skip(process.env.E2E_STRUCTURAL_REPAIR !== "1", "승인된 구조 수리 Preview만 실행합니다.");
  test.setTimeout(240_000);
  const student = await previewRun.createStudent("structural-repair");
  const admin = previewRun.adminPage;
  await openSingleAssignment(admin, student);
  const dialog = admin.getByRole("dialog", { name: "단일 배정", exact: true });
  await expect(dialog).toBeVisible();
  const title = dialog.getByRole("textbox").first();
  const before = await title.inputValue();
  const background = await admin.context().newPage();
  await background.goto("about:blank"); await background.bringToFront();
  await admin.bringToFront(); await background.close();
  await expect(dialog).toBeVisible(); await expect(title).toHaveValue(before);
  await dialog.getByRole("button", { name: "닫기", exact: true }).first().click();
  const response = await assignSingleRange(admin, student, {
    datasetId: "b6100000-0000-4000-8000-000000000004", questionCount: 4,
    rangeMode: "all", scheduleEnabled: false, timeLimit: "none",
  }) as { assignments: Array<{ student_id: string; assignment_id: string; status: string }> };
  const assigned = response.assignments.filter(row => row.student_id === student.id && row.status === "assigned");
  expect(assigned).toHaveLength(1);
  const page = await previewRun.openStudent(student);
  await startLocalAssignment(page, assigned[0].assignment_id);
  const first = await finishLocalPhase(page, [0, 1]);
  expect(first.result).toMatchObject({ state: "retry_waiting", finalized: false, attempt: { initialScore: 50 } });
  await startLocalRetry(page);
  const retry = await finishLocalPhase(page, [0]);
  expect(retry.result).toMatchObject({ state: "failed", finalized: true, attempt: { finalScore: 75, unresolvedWrongCount: 1 } });
  await page.goto("/student/wordbook?view=current");
  await expect(page.getByRole("list", { name: "내 단어장" }).getByRole("listitem")).toHaveCount(1);
  await expect(page.getByText("1개 단어 · 현재 오답 2회", { exact: true })).toBeVisible();
  await page.screenshot({ path: test.info().outputPath("내단어장_조회.png") });
});
