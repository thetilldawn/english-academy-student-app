import fs from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

function source(fileName: string) {
  return fs.readFileSync(path.resolve("src/lib/quiz", fileName), "utf8");
}

describe("question engine module boundaries", () => {
  it("uses direct responsibility modules without the retired engine entry", () => {
    expect(fs.existsSync(path.resolve("src/lib/quiz/engine.ts"))).toBe(false);

    const identity = source("word-identity.ts");
    const policy = source("choice-policy.ts");
    const generator = source("question-generator.ts");
    const mixed = source("mixed-question-planner.ts");
    const scoring = source("quiz-scoring.ts");

    expect(identity).toContain('from "./question-types"');
    expect(identity).not.toContain("choice-policy");
    expect(policy).toContain('from "./word-identity"');
    expect(policy).not.toContain("question-generator");
    expect(generator).toContain('from "./choice-policy"');
    expect(generator).not.toContain("mixed-question-planner");
    expect(mixed).toContain('from "./question-generator"');
    expect(scoring).not.toContain("from ");
  });
});
