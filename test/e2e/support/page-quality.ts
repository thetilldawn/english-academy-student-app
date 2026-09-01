import AxeBuilder from "@axe-core/playwright";
import { expect, type Page } from "@playwright/test";

export function collectUnexpectedBrowserMessages(page: Page) {
  const messages: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "warning" || message.type() === "error") {
      messages.push(`console.${message.type()}: ${message.text()}`);
    }
  });
  page.on("pageerror", (error) => {
    messages.push(`pageerror: ${error.message}`);
  });
  return messages;
}

export async function expectNoSeriousAccessibilityViolations(page: Page) {
  const results = await new AxeBuilder({ page }).analyze();
  const serious = results.violations.filter(
    (violation) =>
      violation.impact === "serious" || violation.impact === "critical",
  );
  expect(serious, JSON.stringify(serious, null, 2)).toEqual([]);
}

export async function expectNoHorizontalOverflow(page: Page) {
  const overflow = await page.evaluate(() => ({
    body: document.body.scrollWidth - document.body.clientWidth,
    document:
      document.documentElement.scrollWidth - document.documentElement.clientWidth,
  }));
  expect(overflow.body).toBeLessThanOrEqual(1);
  expect(overflow.document).toBeLessThanOrEqual(1);
}

export async function expectKeyboardFocusVisible(page: Page) {
  await page.locator("body").click({ position: { x: 1, y: 1 } });
  await page.keyboard.press("Tab");
  const focused = page.locator(":focus");
  await expect(focused).toBeVisible();
  await expect(focused).not.toHaveJSProperty("tagName", "BODY");
  const indicator = await focused.evaluate((element) => {
    const readStyle = () => {
      const style = window.getComputedStyle(element);
      return {
        boxShadow: style.boxShadow,
        outlineColor: style.outlineColor,
        outlineStyle: style.outlineStyle,
        outlineWidth: Number.parseFloat(style.outlineWidth),
      };
    };
    const hasVisibleColor = (value: string) => {
      if (value === "transparent") return false;
      const alpha = value.match(
        /^rgba\([^,]+,[^,]+,[^,]+,\s*([0-9.]+)\)$/,
      );
      return !alpha || Number(alpha[1]) > 0.01;
    };
    const focusedStyle = readStyle();
    (element as HTMLElement).blur();
    const blurredStyle = readStyle();
    const shadowColors =
      focusedStyle.boxShadow.match(/rgba?\([^)]*\)/g) ?? [];
    const shadowNumbers = focusedStyle.boxShadow
      .replace(/rgba?\([^)]*\)/g, "")
      .match(/-?[0-9.]+px/g)
      ?.map((value) => Math.abs(Number.parseFloat(value))) ?? [];
    const outlineChanged =
      focusedStyle.outlineStyle !== blurredStyle.outlineStyle ||
      focusedStyle.outlineWidth !== blurredStyle.outlineWidth ||
      focusedStyle.outlineColor !== blurredStyle.outlineColor;
    return {
      blurredStyle,
      focusedStyle,
      hasBoxShadow:
        focusedStyle.boxShadow !== "none" &&
        focusedStyle.boxShadow !== blurredStyle.boxShadow &&
        shadowNumbers.some((value) => value >= 0.5) &&
        (shadowColors.length === 0 || shadowColors.some(hasVisibleColor)),
      hasOutline:
        outlineChanged &&
        focusedStyle.outlineStyle !== "none" &&
        focusedStyle.outlineWidth >= 1 &&
        hasVisibleColor(focusedStyle.outlineColor),
    };
  });
  expect(
    indicator.hasOutline || indicator.hasBoxShadow,
    `키보드 초점 표시가 보이지 않습니다: ${JSON.stringify(indicator)}`,
  ).toBe(true);
}
