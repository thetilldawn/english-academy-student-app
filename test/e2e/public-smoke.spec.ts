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
  await page.emulateMedia({ colorScheme: "light" });
  await page.goto("/");
  await expect(page.locator("main#main-content")).toBeVisible();
  await expect(page.getByRole("heading", { name: "영어 학습실", level: 1 })).toBeVisible();
  await expect(page.getByRole("textbox", { name: "학생 접속코드" })).toBeVisible();
  await expect(page.getByRole("button", { name: "인증" })).toBeVisible();
  const studentButton = page.getByRole("button", { name: "인증" });
  const studentCode = page.getByRole("textbox", { name: "학생 접속코드" });
  await expect(studentButton).toHaveCSS("height", "58px");
  await studentCode.focus();
  await expect(studentCode).toBeFocused();
  expect(await studentCode.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(true);
  await expectNoSeriousAccessibilityViolations(page);

  const lightBackground = await page.locator("body").evaluate(
    (element) => getComputedStyle(element).backgroundColor,
  );
  await page.emulateMedia({ colorScheme: "dark" });
  await page.reload();
  const darkBackground = await page.locator("body").evaluate(
    (element) => getComputedStyle(element).backgroundColor,
  );
  expect(darkBackground).not.toBe(lightBackground);
  await expect(page.getByRole("button", { name: "인증" })).toHaveCSS("height", "58px");
  await expectNoSeriousAccessibilityViolations(page);

  await page.emulateMedia({ colorScheme: "dark", reducedMotion: "reduce" });
  await page.reload();
  await expect(page.getByRole("button", { name: "인증" })).toHaveCSS(
    "transition-duration",
    "0s",
  );

  await page.getByRole("link", { name: "관리자 페이지 →" }).click();
  await expect(page).toHaveURL(/\/admin\/login$/);
  await expect(page.getByRole("heading", { name: "관리자 로그인", level: 1 })).toBeVisible();
  await expect(page.getByRole("textbox", { name: "관리자 이메일" })).toBeVisible();
  await expect(page.getByLabel("비밀번호")).toBeVisible();
  await expect(
    page.getByRole("button", { name: "관리자 로그인", exact: true }),
  ).toHaveCSS("height", "58px");
  await expectNoSeriousAccessibilityViolations(page);
});
