import fs from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

function source(relativePath: string) {
  return fs.readFileSync(path.resolve(relativePath), "utf8");
}

describe("admin result detail answer flow", () => {
  it("does not repeat the correct answer after a successful retry", () => {
    const detail = source(
      "src/components/admin-history-detail.tsx",
    );

    expect(detail).toContain(
      'resolved ? " answer-flow-resolved" : ""',
    );
    expect(detail).toContain("!resolved ? (");
    expect(detail).toContain(
      '<span className="sr-only">',
    );
    expect(detail).toContain("adminHistoryText.resultDetail.retryCorrectSr");
    expect(detail).toContain(
      "<strong>{presentation.correctAnswer}</strong>",
    );
  });

  it("uses a compact three-column layout for resolved retries", () => {
    const css = source("src/app/globals.css");

    expect(css).toContain(".answer-flow-resolved");
    expect(css).toContain(
      "grid-template-columns: minmax(0, 1fr) auto minmax(0, 1fr);",
    );
  });
});
