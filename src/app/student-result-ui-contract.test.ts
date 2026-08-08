import fs from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

function source(relativePath: string) {
  return fs.readFileSync(path.resolve(relativePath), "utf8");
}

describe("student result question review", () => {
  it("shows only the correct answer and colors the left bar by wrong count", () => {
    const page = source("src/app/student/(protected)/result/[id]/page.tsx");
    const styles = source("src/app/globals.css");

    expect(page).toContain("question.wrongCount >= 2 ? 2 : 1");
    expect(page).toContain("data-wrong-level={wrongLevel}");
    expect(page).toContain('"choice-correct"');
    expect(page).toContain("question.correctChoiceIndex + 1");
    expect(page).toContain("studentAppText.result.question.answer");
    expect(page).not.toContain("studentAppText.result.question.initialChoice");
    expect(page).not.toContain("studentAppText.result.question.retryCorrect");
    expect(page).not.toContain("studentAppText.result.question.retryWrong");
    expect(page).not.toContain("studentAppText.result.question.retryPending");
    expect(styles).toMatch(
      /\.result-question\[data-wrong-level="1"\]\s*\{\s*border-left-color:\s*var\(--retry-bar\)/,
    );
    expect(styles).toMatch(
      /\.result-question\[data-wrong-level="2"\]\s*\{\s*border-left-color:\s*var\(--fail\)/,
    );
  });
});
