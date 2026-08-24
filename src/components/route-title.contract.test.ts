import fs from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

function source(relativePath: string) {
  return fs.readFileSync(path.resolve(relativePath), "utf8");
}

describe("공통 경로 제목 계약", () => {
  it("관리자 셸에서 한 번 표시하고 각 페이지는 중복 제목을 만들지 않는다", () => {
    expect(source("src/app/admin/(protected)/layout.tsx"))
      .toContain("<AdminCurrentRouteTitle />");
    for (const page of [
      "src/app/admin/(protected)/page.tsx",
      "src/app/admin/(protected)/students/page.tsx",
      "src/app/admin/(protected)/assignments/page.tsx",
      "src/app/admin/(protected)/results/page.tsx",
      "src/app/admin/(protected)/results/[id]/page.tsx",
    ]) {
      expect(source(page)).not.toContain("AdminBreadcrumb");
    }
    expect(source("src/app/admin/(protected)/error.tsx"))
      .not.toContain("<h1");
  });

  it("학생 셸은 경로 제목을 쓰고 목록·결과 내용은 별도 h1을 만들지 않는다", () => {
    expect(source("src/components/student-shell.tsx"))
      .toContain("studentBreadcrumbForPathname");
    expect(source("src/features/student-dashboard/ui/student-dashboard.tsx"))
      .not.toContain("<h1");
    expect(source("src/features/results/ui/student-result-view.tsx"))
      .not.toContain("<h1");
  });
});
