import fs from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

function source(fileName: string) {
  return fs.readFileSync(
    path.resolve("src/lib/services/quiz", fileName),
    "utf8",
  );
}

describe("student quiz service boundaries", () => {
  it("uses direct query and command modules without the retired service entry", () => {
    expect(
      fs.existsSync(path.resolve("src/lib/services/quiz-service.ts")),
    ).toBe(false);

    const command = source("attempt-command.ts");
    const query = source("attempt-query.ts");
    const resultQuery = source("attempt-result-query.ts");
    const snapshot = source("question-snapshot.ts");
    const resultMapper = source("result-question-mapper.ts");

    expect(query).toContain('from "./attempt-command"');
    expect(command).not.toContain("attempt-query");
    expect(resultQuery).toContain('from "./result-question-mapper"');
    expect(resultQuery).toContain('from "./pronunciation-registry"');
    expect(resultQuery).not.toContain("attempt-command");
    expect(snapshot).not.toContain("server-only");
    expect(snapshot).not.toContain("supabase");
    expect(resultMapper).not.toContain("server-only");
    expect(resultMapper).not.toContain("supabase");
  });
});
