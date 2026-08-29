import fs from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

const source = fs.readFileSync(
  path.resolve("src/lib/services/admin-history-read-service.ts"),
  "utf8",
);
const allocationRuleSource = fs.readFileSync(
  path.resolve(
    "src/lib/services/vocab-unit-allocation-rule-read-service.ts",
  ),
  "utf8",
);
const dashboardQuery = fs.readFileSync(
  path.resolve(
    "src/features/student-dashboard/server/queries/student-dashboard-query.ts",
  ),
  "utf8",
);
const dashboardRowSchema = fs.readFileSync(
  path.resolve(
    "src/features/student-dashboard/server/queries/student-dashboard-row-schema.ts",
  ),
  "utf8",
);
const dashboardReadModel = fs.readFileSync(
  path.resolve(
    "supabase/migrations/20260829190000_add_student_dashboard_read_model.sql",
  ),
  "utf8",
);
const studentCard = fs.readFileSync(
  path.resolve(
    "src/features/student-dashboard/ui/student-assignment-card.tsx",
  ),
  "utf8",
);
const studentDashboardDomain = fs.readFileSync(
  path.resolve(
    "src/features/student-dashboard/domain/student-assignment-sections.ts",
  ),
  "utf8",
);
const studentAssignmentLifecycle = fs.readFileSync(
  path.resolve(
    "src/features/student-dashboard/domain/student-assignment-lifecycle.ts",
  ),
  "utf8",
);
const directDetailPage = fs.readFileSync(
  path.resolve("src/app/admin/(protected)/results/[id]/page.tsx"),
  "utf8",
);
const interceptedDetailPage = fs.readFileSync(
  path.resolve(
    "src/app/admin/(protected)/@detail/(.)results/[entryKey]/page.tsx",
  ),
  "utf8",
);

describe("admin assignment history query contract", () => {
  it("시험 목적과 주 DAY를 함께 조회하고 내역 모델로 전달한다", () => {
    expect(source).toContain("assignment_purpose,");
    expect(source).toContain("is_primary,");
    expect(source).toContain(
      "assignmentPurpose: assignment.assignment_purpose",
    );
    expect(source).toContain("primaryUnitIds:");
    expect(source).toContain("primaryUnitLabels:");
    expect(source).toContain("timing_mode,");
    expect(source).toContain("question_time_limit_seconds,");
    expect(source).toContain("available_from,");
    expect(source).toContain("timingMode: assignment.timing_mode");
    expect(source).toContain(
      "questionTimeLimitSeconds: assignment.question_time_limit_seconds",
    );
    expect(source).toContain("availableFrom: assignment.available_from");
  });

  it("학생 배정 목록도 시험 목적과 주 DAY만 표시한다", () => {
    expect(dashboardReadModel).toContain("assignment.assignment_purpose");
    expect(dashboardReadModel).toContain("filter (where link.is_primary)");
    expect(dashboardReadModel).toContain("'primaryUnitLabels'");
    expect(dashboardRowSchema).toContain("scopeLabel: assignmentScopeLabel");
    expect(studentCard).toContain("assignment.scopeLabel");
    expect(studentCard).toContain('assignment.assignmentPurpose === "review"');
    expect(studentCard).not.toContain("assignmentOrderLabel(");
    expect(studentCard).not.toContain("assignmentTimingLabel(");
  });

  it("reads persisted missed assignment state without changing it", () => {
    expect(source).toContain("missed_at,");
    expect(source).toContain("missedAt: row.missed_at");
    expect(dashboardReadModel).not.toContain("finalizeStudentMissedAssignments");
    expect(dashboardReadModel).toContain("recipient.missed_at <= p_snapshot_at");
    expect(dashboardReadModel).toContain("recipient.cancelled_at is null");
    expect(studentDashboardDomain).toContain(
      "missedAt: assignment.missedAt",
    );
    expect(studentDashboardDomain).toContain(
      "studentAssignmentActivityInput(left)",
    );
    expect(studentDashboardDomain).toContain(
      "studentAssignmentActivityInput(right)",
    );
    expect(studentDashboardDomain).toContain(
      'lifecycle.progress === "missed"',
    );
    expect(dashboardReadModel).toContain("recipient.assigned_at");
    expect(dashboardReadModel).toContain("'availableFrom', classified.available_from");
    expect(studentAssignmentLifecycle).toContain(
      'progress === "not_started"',
    );
  });

  it("does not turn student assignment query failures into an empty dashboard", () => {
    expect(dashboardQuery).toContain("if (error) {");
    expect(dashboardQuery).toContain("StudentDashboardReadError");
    expect(dashboardQuery).toContain('"contract"');
  });

  it("reuses the read-only history rows within an editable detail request", () => {
    expect(source).toContain('import { cache } from "react";');
    expect(source).toContain(
      "const loadAssignmentHistoryBundleForRequest = cache(",
    );
    expect(source).toContain(
      "const loadAssignmentHistoryRowsForRequest = cache(",
    );
    for (const detailPage of [directDetailPage, interceptedDetailPage]) {
      expect(detailPage).toMatch(
        /loadAssignmentManagerData\(\{[\s\S]*?reuseMaterialRequestCache:\s*false,[\s\S]*?\}\)/,
      );
      expect(detailPage).not.toContain("finalizeStale");
    }
  });

  it("최근 조건 복사용 단위 규칙은 학생·단어장별 최근 후보만 조회한다", () => {
    expect(source).toContain("recentAllocationRuleAssignmentIds(");
    expect(source).toContain(
      "RECENT_ALLOCATION_RULE_CANDIDATES_PER_DATASET = 3",
    );
    expect(allocationRuleSource).toContain('error?.code === "PGRST202"');
    expect(source).not.toContain(
      "assignmentStudentData.map((row) => row.assignment_id)",
    );
  });
});
