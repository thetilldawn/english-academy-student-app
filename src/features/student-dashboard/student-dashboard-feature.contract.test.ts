import fs from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

function source(relativePath: string) {
  return fs.readFileSync(path.resolve(relativePath), "utf8");
}

describe("student dashboard feature boundary", () => {
  const page = source("src/app/student/(protected)/page.tsx");
  const dashboard = source(
    "src/features/student-dashboard/ui/student-dashboard.tsx",
  );
  const dashboardCss = source(
    "src/features/student-dashboard/ui/student-dashboard.module.css",
  );
  const card = source(
    "src/features/student-dashboard/ui/student-assignment-card.tsx",
  );
  const cardCss = source(
    "src/features/student-dashboard/ui/student-assignment-card.module.css",
  );
  const globalCss = source("src/app/globals.css");

  it("leaves the route responsible only for server loading and feature composition", () => {
    expect(page).toContain("listStudentAssignments(session.studentId)");
    expect(page).toContain("<StudentDashboard");
    expect(page).not.toMatch(
      /function AssignmentCard|assignments\.filter|<article|activitySection/,
    );
  });

  it("keeps assignment structure in small semantic components", () => {
    expect(dashboard).toContain("selectStudentAssignmentSections(assignments)");
    expect(dashboard).toContain("<StudentAssignmentCard");
    expect(card).toContain("<article");
    expect(card).toContain("<ActivityStatusTimeline");
    expect(card).toContain("<AttemptScoreSummary");
    expect(card).not.toMatch(/className=["'][^"']+(?:assignment-card|student-)/);
  });

  it("uses a responsive grid without removing information at any breakpoint", () => {
    expect(dashboardCss).toMatch(
      /\.grid\s*\{[^}]*grid-template-columns:\s*repeat\([\s\S]*?auto-fit,[\s\S]*?minmax\(min\(100%, 430px\), 1fr\)/,
    );
    expect(cardCss).toMatch(
      /\.title\s*\{[^}]*min-width:\s*0;[\s\S]*?-webkit-line-clamp:\s*2;/,
    );
    expect(cardCss).toMatch(
      /@media \(max-width: 960px\)[\s\S]*?\.titleRow\s*\{[^}]*grid-template-columns:\s*minmax\(0, 1fr\);/,
    );
    expect(`${dashboardCss}\n${cardCss}`).not.toContain("display: none");
  });

  it("keeps retired student dashboard selectors out of the global cascade", () => {
    expect(globalCss).not.toMatch(
      /\.(?:student-page-heading|student-assignment-grid|assignment-card|assignment-details|assignment-deadline|assignment-actions|deadline-countdown|deadline-expired)/,
    );
  });
});
