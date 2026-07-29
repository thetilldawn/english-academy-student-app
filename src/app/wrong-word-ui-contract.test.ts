import fs from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

function source(filePath: string) {
  return fs.readFileSync(path.resolve(filePath), "utf8");
}

describe("wrong-word admin UI contract", () => {
  it("keeps personal history behind an authenticated dynamic endpoint", () => {
    const route = source(
      "src/app/api/admin/students/[id]/wrong-words/route.ts",
    );
    expect(route).toContain('export const dynamic = "force-dynamic"');
    expect(route).toContain("getAdminContext()");
    expect(route).toContain("z.uuid()");
    expect(route).toContain("getStudentWrongWordHistory(id, admin)");
  });

  it("loads wrong words only inside the student detail tab", () => {
    const manager = source("src/components/student-manager.tsx");
    const panel = source(
      "src/components/student-wrong-word-panel.tsx",
    );
    expect(manager).toContain('"history" | "wrong" | "manage"');
    expect(manager).toContain("<StudentWrongWordPanel");
    expect(panel).toContain(
      "/api/admin/students/${studentId}/wrong-words",
    );
    expect(panel).toContain('cache: "no-store"');
    expect(panel).toContain("AbortController");
    expect(panel).toContain('role="tablist"');
    expect(panel).toContain("WRONG_HISTORY_CACHE_TTL_MS");
    expect(panel).toContain("새로고침");
    expect(panel).toContain("tabIndex=");
    expect(manager).toContain("moveDialogTabFocus");
    expect(panel).toContain("누적 2회 이상");
  });

  it("pages event history below the PostgREST row limit", () => {
    const service = source(
      "src/lib/services/wrong-word-service.ts",
    );
    expect(service).toContain("MAX_WRONG_EVENTS = 400");
    expect(service).toContain("WRONG_EVENT_PAGE_SIZE = 200");
    expect(service).toContain('.order("id", { ascending: false })');
    expect(service).toContain('query = query.lt("id", beforeId)');
    expect(service).not.toContain(".limit(MAX_WRONG_EVENTS + 1)");
  });

  it("exposes only the clamped prior wrong level to the quiz client", () => {
    const quizService = source("src/lib/services/quiz-service.ts");
    expect(quizService).toContain("prior_wrong_count");
    expect(quizService).toContain("priorWrongLevel:");
    expect(quizService).toContain("question.prior_wrong_count >= 2");
    expect(quizService).not.toContain("priorWrongCount:");
  });
});
