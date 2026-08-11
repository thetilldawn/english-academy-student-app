import fs from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

function source(relativePath: string) {
  return fs.readFileSync(path.resolve(relativePath), "utf8");
}

describe("한국어 UI 문구 카탈로그", () => {
  it("위치 주석이 있는 key-value 문구를 실제 화면에서 불러온다", () => {
    const learningCopy = source("src/content/ko/admin-learning.ts");
    const studentCopy = source("src/content/ko/admin-students.ts");
    const shellCopy = source("src/content/ko/admin-shell.ts");
    const overviewCopy = source("src/content/ko/admin-overview.ts");
    const historyCopy = source("src/content/ko/admin-history.ts");
    const studentAppCopy = source("src/content/ko/student-app.ts");
    const manager = source("src/components/assignment-manager.tsx");
    const assignmentSettings = source(
      "src/features/assignments/ui/assignment-settings-fields.tsx",
    );
    const studentManager = source("src/components/student-manager.tsx");
    const navigation = source("src/components/admin-navigation.tsx");
    const adminRoutes = source("src/lib/ui/admin-routes.ts");
    const history = source(
      "src/features/history/ui/admin-history-list.tsx",
    );
    const studentLogin = source("src/components/student-login-form.tsx");

    expect(learningCopy).toContain("// 학습 관리 > 학생별 단어 학습 배정 모달");
    expect(studentCopy).toContain("// 학생 관리 > 학생 추가 모달");
    expect(learningCopy).toContain("as const");
    expect(studentCopy).toContain("as const");
    expect(shellCopy).toContain("// 관리자 공통 셸");
    expect(overviewCopy).toContain("// Overview");
    expect(historyCopy).toContain("// 내역 페이지");
    expect(studentAppCopy).toContain("// 학생 첫 화면");
    expect(manager).toContain('from "@/content/ko/admin-learning"');
    expect(studentManager).toContain('from "@/content/ko/admin-students"');
    expect(assignmentSettings).toContain(
      "adminLearningText.assignmentModal.deadline.label",
    );
    expect(studentManager).toContain(
      "adminStudentsText.createStudent.startingWordbookHelp",
    );
    expect(navigation).toContain('from "@/lib/ui/admin-routes"');
    expect(adminRoutes).toContain('from "@/content/ko/admin-shell"');
    expect(history).toContain('from "@/content/ko/admin-history"');
    expect(studentLogin).toContain('from "@/content/ko/student-app"');
  });
});
