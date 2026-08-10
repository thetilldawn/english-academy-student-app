import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";

async function expectNoSeriousAccessibilityViolations(page: Page) {
  const results = await new AxeBuilder({ page }).analyze();
  const serious = results.violations.filter((violation) =>
    violation.impact === "serious" || violation.impact === "critical",
  );
  expect(serious, JSON.stringify(serious, null, 2)).toEqual([]);
}

test("student and admin public login surfaces render and remain accessible", async ({ page }) => {
  await page.goto("/");
  await expect(page.locator("main#main-content")).toBeVisible();
  await expect(page.getByRole("heading", { name: "영어 학습실", level: 1 })).toBeVisible();
  await expect(page.getByRole("textbox", { name: "학생 접속코드" })).toBeVisible();
  await expect(page.getByRole("button", { name: "인증" })).toBeVisible();
  await expectNoSeriousAccessibilityViolations(page);

  await page.getByRole("link", { name: "관리자 페이지 →" }).click();
  await expect(page).toHaveURL(/\/admin\/login$/);
  await expect(page.getByRole("heading", { name: "관리자 로그인", level: 1 })).toBeVisible();
  await expect(page.getByRole("textbox", { name: "관리자 이메일" })).toBeVisible();
  await expect(page.getByLabel("비밀번호")).toBeVisible();
  await expectNoSeriousAccessibilityViolations(page);
});
