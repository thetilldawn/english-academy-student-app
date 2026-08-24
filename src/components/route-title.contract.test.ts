import fs from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

function source(relativePath: string) {
  return fs.readFileSync(path.resolve(relativePath), "utf8");
}

describe("공통 상단바 제목 계약", () => {
  it("관리자 상단바는 보이는 경로 제목 없이 화면 읽기용 제목만 둔다", () => {
    expect(source("src/app/admin/(protected)/layout.tsx"))
      .toContain("<AdminRouteScreenReaderTitle />");
    expect(source("src/app/admin/(protected)/layout.tsx"))
      .not.toContain("AdminBreadcrumb");
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

  it("학생 상단바도 보이는 경로 제목 없이 화면 읽기용 제목만 둔다", () => {
    expect(source("src/components/student-shell.tsx"))
      .toContain("<RouteScreenReaderTitle title={pageTitle} />");
    expect(source("src/components/student-shell.tsx"))
      .not.toContain("AdminBreadcrumb");
    expect(source("src/features/student-dashboard/ui/student-dashboard.tsx"))
      .not.toContain("<h1");
    expect(source("src/features/results/ui/student-result-view.tsx"))
      .not.toContain("<h1");
  });

  it("상단 동작 버튼은 제목이 없어도 오른쪽에 정렬한다", () => {
    expect(source("src/components/shell/app-shell.module.css"))
      .toContain("margin-inline-start: auto");
  });
});
