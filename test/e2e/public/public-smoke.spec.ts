import { expect, test } from "@playwright/test";

import { establishVercelProtectionSession } from "../support/environment";
import {
  collectUnexpectedBrowserMessages,
  expectKeyboardFocusVisible,
  expectNoHorizontalOverflow,
  expectNoSeriousAccessibilityViolations,
} from "../support/page-quality";

test("학생·관리자 공개 로그인 화면은 세 화면 크기에서 접근 가능하다", async ({ page }) => {
  await establishVercelProtectionSession(page.context());
  const browserMessages = collectUnexpectedBrowserMessages(page);
  await page.emulateMedia({ colorScheme: "light" });
  await page.goto("/");
  await expect(page.locator("main#main-content")).toBeVisible();
  await expect(page.getByRole("heading", { name: "영어 학습실", level: 1 })).toBeVisible();
  await expect(page.getByRole("textbox", { name: "학생 접속코드" })).toBeVisible();
  await expect(page.getByRole("button", { name: "인증" })).toHaveCSS(
    "height",
    "58px",
  );
  await expectKeyboardFocusVisible(page);
  await expectNoHorizontalOverflow(page);
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
  await expectNoHorizontalOverflow(page);
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
  await expectNoHorizontalOverflow(page);
  await expectNoSeriousAccessibilityViolations(page);
  expect(browserMessages).toEqual([]);
});
