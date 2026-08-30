import fs from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

function source(relativePath: string) {
  return fs.readFileSync(path.resolve(relativePath), "utf8");
}

describe("admin history query boundaries", () => {
  it("reads each history section in fixed pages of ten", () => {
    const listQuery = source(
      "src/features/history/server/queries/admin-history-list-query.ts",
    );
    expect(listQuery).toContain("const PAGE_SIZE = 10");
    expect(listQuery).toContain("const DATABASE_PAGE_LIMIT = PAGE_SIZE + 1");
    expect(listQuery).toContain('"get_admin_history_initial_v1"');
    expect(listQuery).toContain('"list_admin_history_page_v1"');
  });

  it("composes one detail with its attempt and point summary only", () => {
    const detailQuery = source(
      "src/features/history/server/queries/admin-history-detail-query.ts",
    );
    expect(detailQuery).toContain('"get_admin_history_detail_v1"');
    expect(detailQuery).toContain("getAdminAttemptDetail(summary.attemptId, admin)");
    expect(detailQuery).toContain(
      "getAdminAttemptPointSummary(summary.studentId, summary.attemptId)",
    );
    expect(detailQuery).not.toContain("AssignmentManagerData");
    expect(detailQuery).not.toContain("loadAssignmentManagerData");
  });

  it("keeps attempt ownership inside history and exposes a server entry point", () => {
    const attemptQuery = source(
      "src/features/history/server/queries/admin-attempt-detail-query.ts",
    );
    const publicServer = source("src/features/history/public-server.ts");
    const attemptRoute = source("src/app/api/admin/attempts/[id]/route.ts");

    expect(attemptQuery).toContain("getAttemptQuestionResults(attemptId)");
    expect(attemptQuery).toContain("deriveAttemptQuestionMetrics(questions)");
    expect(publicServer).toContain(
      'from "./server/queries/admin-attempt-detail-query"',
    );
    expect(attemptRoute).toContain('from "@/features/history/public-server"');
    expect(attemptRoute).not.toContain("admin-attempt-read-service");
  });

  it("does not preload assignment edit context on detail pages", () => {
    for (const detailPagePath of [
      "src/app/admin/(protected)/results/[id]/page.tsx",
      "src/app/admin/(protected)/@detail/(.)results/[entryKey]/page.tsx",
    ]) {
      const detailPage = source(detailPagePath);
      expect(detailPage).toContain("getAdminHistoryReadModelDetail");
      expect(detailPage).not.toContain("loadAssignmentManagerData");
      expect(detailPage).not.toContain("AssignmentEditContext");
    }
  });
});
