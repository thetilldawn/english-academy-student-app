import fs from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

function source(relativePath: string) {
  return fs.readFileSync(path.resolve(relativePath), "utf8");
}

describe("mixed assignment admin UI contract", () => {
  it("loads pending-review and current-wrong summaries once", () => {
    const page = source("src/app/admin/(protected)/assignments/page.tsx");
    const loader = source("src/lib/services/assignment-manager-data.ts");

    expect(loader.match(/listStudentPendingReviewSummaries\(\)/g)).toHaveLength(1);
    expect(loader.match(/listStudentCurrentVocabWrongSummaries\(\)/g)).toHaveLength(1);
    expect(loader).toContain("pendingReviewSummaries,");
    expect(loader).toContain("currentVocabWrongSummaries,");
    expect(page).toContain("{...managerData}");
  });

  it("keeps filters in the manager and mixed controls in the single editor", () => {
    const manager = source("src/components/assignment-manager.tsx");
    const reviewFields = source(
      "src/features/assignments/ui/assignment-review-fields.tsx",
    );
    const settings = source(
      "src/features/assignments/ui/assignment-settings-fields.tsx",
    );
    const controller = source(
      "src/features/assignments/controller/use-assignment-controller.ts",
    );
    const copy = source("src/content/ko/admin-learning.ts");

    expect(manager).toContain("commonText.filters.hasWrong");
    expect(manager).toContain("wrongCounts.repeatedWrongWordCount > 0");
    expect(manager).toContain("<SingleAssignmentEditor");
    expect(reviewFields).toContain('event.target.checked ? "pending" : "none"');
    expect(reviewFields).toContain('value: "dataset"');
    expect(reviewFields).toContain('value: "selection"');
    expect(reviewFields).toContain("wrongLevel1Eligible");
    expect(reviewFields).toContain("wrongLevel2Eligible");
    expect(settings).toContain('value="ascending"');
    expect(settings).toContain('value="descending"');
    expect(settings).toContain('value="random"');
    expect(controller).toContain('review: { mode: "none", scope: "dataset"');
    expect(copy).toContain('title: "틀렸던 단어 추가"');
    expect(copy).toContain('perQuestionTime: "문제당 시간(초)"');
  });

  it("owns lifecycle and close protection in the controller boundary", () => {
    const manager = source("src/components/assignment-manager.tsx");
    const controller = source(
      "src/features/assignments/controller/use-assignment-controller.ts",
    );
    const preview = source(
      "src/features/assignments/controller/use-assignment-preview.ts",
    );

    expect(manager).toContain("closeDisabled={editorBusy}");
    expect(manager).toContain("onBusyChange={setEditorBusy}");
    expect(manager).not.toMatch(/\bfetch\s*\(/);
    expect(controller).toContain("reduceAssignmentEditorState(");
    expect(controller).toContain('state.submission.status === "idle"');
    expect(controller).toContain(
      "stateRef.current.submission.requestId !== requestId",
    );
    expect(preview).toContain("AbortController");
    expect(preview).toContain("delayMs = 120");
  });

  it("builds regular and mixed requests only through typed adapters", () => {
    const manager = source("src/components/assignment-manager.tsx");
    const adapters = source(
      "src/features/assignments/api/request-adapters.ts",
    );
    const controller = source(
      "src/features/assignments/controller/use-assignment-controller.ts",
    );

    expect(controller).toContain("buildSingleAssignmentRequest(");
    expect(adapters).toContain('endpoint: "/api/admin/assignments"');
    expect(adapters).toContain('endpoint: "/api/admin/mixed-assignments"');
    expect(adapters).toContain("primaryUnitIds:");
    expect(adapters).toContain("totalQuestionCount:");
    expect(manager).not.toMatch(/\bfetch\s*\(/);
    for (const forbiddenKey of [
      "selectedQueueIds",
      "reviewQueueIds",
      "questionDrafts",
      "canonicalLexemeIds",
      "vocabEntryIds",
    ]) {
      expect(adapters).not.toContain(forbiddenKey);
    }
  });

  it("keeps the draft and requests a fresh preview after 409", () => {
    const controller = source(
      "src/features/assignments/controller/use-assignment-controller.ts",
    );
    expect(controller).toContain("response.status === 409");
    expect(controller).toContain('type: "submission/conflicted"');
    expect(controller).toContain("setPreviewRefreshVersion");
    expect(controller).toContain("onConflict?.()");
  });

  it("shows capacity exclusions through a dedicated summary component", () => {
    const summary = source(
      "src/features/assignments/ui/assignment-capacity-summary.tsx",
    );
    const service = source("src/lib/services/mixed-assignment-service.ts");

    expect(service).toContain("eligibleBeforeActiveAssignment");
    expect(service).toContain("activeAssignmentExcluded");
    expect(service).toContain("questionPlanExcluded");
    expect(summary).toContain("capacity.activeAssignmentExcluded");
    expect(summary).toContain("capacity.maximumQuestionCount");
  });

  it("uses domain actions to restore automatic title and question count", () => {
    const reducer = source("src/features/assignments/domain/single-draft.ts");
    const controller = source(
      "src/features/assignments/controller/use-assignment-controller.ts",
    );

    expect(reducer).toContain('type: "title/restoreAutomatic"');
    expect(reducer).toContain('type: "questionCount/restoreAutomatic"');
    expect(controller).toContain('value.trim()');
    expect(controller).toContain('type: "title/restoreAutomatic"');
  });
});
