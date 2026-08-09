import fs from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

function source(relativePath: string) {
  return fs.readFileSync(path.resolve(relativePath), "utf8");
}

describe("mixed assignment admin UI contract", () => {
  it("페이지가 대기열과 실제 오답 요약을 각각 한 번 읽어 전달한다", () => {
    const page = source(
      "src/app/admin/(protected)/assignments/page.tsx",
    );
    const loader = source(
      "src/lib/services/assignment-manager-data.ts",
    );

    expect(loader).toContain("listStudentPendingReviewSummaries()");
    expect(
      loader.match(/listStudentPendingReviewSummaries\(\)/g),
    ).toHaveLength(1);
    expect(loader).toContain("pendingReviewSummaries,");
    expect(loader).toContain("listStudentCurrentVocabWrongSummaries()");
    expect(
      loader.match(/listStudentCurrentVocabWrongSummaries\(\)/g),
    ).toHaveLength(1);
    expect(loader).toContain("currentVocabWrongSummaries,");
    expect(page).toContain("{...managerData}");
  });

  it("목록 필터와 기본 OFF 혼합 설정을 노출한다", () => {
    const manager = source("src/components/assignment-manager.tsx");
    const copy = source("src/content/ko/admin-learning.ts");
    const commonCopy = source("src/content/ko/common.ts");
    const filteredStudents = manager.slice(
      manager.indexOf("const filteredStudents"),
      manager.indexOf("useEffect", manager.indexOf("const filteredStudents")),
    );

    expect(manager).toContain("commonText.filters.hasWrong");
    expect(manager).toContain("commonText.filters.repeatedWrong");
    expect(commonCopy).toContain('hasWrong: "오답 있음"');
    expect(commonCopy).toContain('repeatedWrong: "2회 이상 오답"');
    expect(filteredStudents).toContain(
      "currentVocabWrongIndex.byStudentDataset",
    );
    expect(filteredStudents).toContain(
      "wrongCounts.wrongWordCount > 0",
    );
    expect(filteredStudents).toContain(
      "wrongCounts.repeatedWrongWordCount > 0",
    );
    expect(filteredStudents).not.toContain("pendingReviewIndex");
    expect(filteredStudents).not.toContain("pendingReviewCount(");
    expect(copy).toContain('title: "틀렸던 단어 추가"');
    expect(manager).toContain(
      "adminLearningText.assignmentModal.wrongWords.title",
    );
    expect(manager).toContain("adminLearningText.assignmentModal.range.dayTerm");
    expect(manager).toContain("adminLearningText.assignmentModal.range.unitTerm");
    expect(manager).toContain('useState<ReviewScope>("dataset")');
    expect(manager).toContain('setReviewScope("selection")');
    expect(manager).toContain("capacity.wrongLevel1Eligible");
    expect(manager).toContain("capacity.wrongLevel2Eligible");
    expect(manager).not.toContain("reviewLimit");
    expect(manager).not.toContain("실제 출제 가능 최대");
    expect(manager).not.toContain("단원 후보");
    expect(manager).toContain('value="ascending"');
    expect(manager).toContain('value="descending"');
    expect(manager).toContain('value="random"');
    expect(manager).toContain('useState<TimingMode>("total")');
    expect(manager).toContain(
      'questionCountModeRef.current === "auto"',
    );
    expect(manager).toContain('changeQuestionCountMode("manual")');
    expect(copy).toContain('perQuestionTime: "문제당 시간(초)"');
    expect(manager).toContain(
      "const [includePendingReview, setIncludePendingReview] =",
    );
    expect(manager).toContain("useState(false)");
    expect(manager).not.toContain("<h2>단어 시험 배정</h2>");
    expect(manager).toContain('className="learning-search-panel"');
    expect(manager).not.toContain("확인하고 배정");
    expect(manager).toContain('className="assignment-submit-panel"');
  });

  it("학생·단어장·닫기에서 종속 상태를 초기화하고 제출 중 닫기를 막는다", () => {
    const manager = source("src/components/assignment-manager.tsx");

    expect(manager).toContain("function resetScopedControls()");
    expect(
      manager.match(/resetScopedControls\(\);/g)?.length,
    ).toBeGreaterThanOrEqual(3);
    expect(manager).toContain("onCancel={handleDialogCancel}");
    expect(manager).toContain("if (submitting) event.preventDefault()");
    expect(manager).toContain("disabled={submitting}");
    expect(manager).toContain("refreshPending ||");
    expect(manager).toContain("editLoading ||");
    expect(manager).toContain("if (requestInFlightRef.current) return");
    expect(manager).toContain("requestInFlightRef.current = true");
    expect(manager).toContain("requestInFlightRef.current = false");
    expect(manager).toContain("disabled={exactReviewEdit}");
    expect(manager).toContain('if (!checked) setReviewScope("dataset")');
    expect(manager).toContain('setReviewScope("dataset")');
    expect(manager).toContain('setReviewScope("selection")');
    expect(manager).toContain("setCapacity(null)");
    expect(manager).not.toContain(
      'className="assignment-success-panel"',
    );
    expect(manager).toContain('from "sonner"');
    expect(manager).toContain("toast.success");
    expect(manager).not.toContain("<AppToast");
    expect(manager).toContain("dialogRef.current?.close()");
  });

  it("일반·혼합 payload를 순수 builder로 분기하고 서버 전용값을 노출하지 않는다", () => {
    const manager = source("src/components/assignment-manager.tsx");
    const builder = source(
      "src/lib/admin/assignment-submission.ts",
    );

    expect(manager).toContain("buildAssignmentSubmission({");
    expect(builder).toContain('"/api/admin/assignments"');
    expect(builder).toContain('"/api/admin/mixed-assignments"');
    expect(builder).toContain("primaryUnitIds:");
    expect(builder).toContain("totalQuestionCount:");
    for (const forbiddenKey of [
      "selectedQueueIds",
      "reviewQueueIds",
      "questionDrafts",
      "canonicalLexemeIds",
      "vocabEntryIds",
    ]) {
      expect(manager).not.toContain(forbiddenKey);
      expect(builder).not.toContain(forbiddenKey);
    }
  });

  it("409에서는 입력을 유지한 채 서버 요약만 새로고친다", () => {
    const manager = source("src/components/assignment-manager.tsx");

    expect(manager).toContain("if (response.status === 409)");
    expect(manager).toContain(
      "startRefreshTransition(() => router.refresh())",
    );
    expect(manager).not.toContain(
      'response.status === 409 ? "/api/admin/assignments"',
    );
  });

  it("원본 수와 실제 배정 가능 수가 달라지는 이유를 단계별로 표시한다", () => {
    const manager = source("src/components/assignment-manager.tsx");
    const service = source(
      "src/lib/services/mixed-assignment-service.ts",
    );
    const copy = source("src/content/ko/admin-learning.ts");

    expect(service).toContain("eligibleBeforeActiveAssignment");
    expect(service).toContain("activeAssignmentExcluded");
    expect(service).toContain("questionPlanExcluded");
    expect(manager).toContain('className="selection-capacity-summary"');
    expect(manager).toContain("capacity.activeAssignmentExcluded");
    expect(copy).toContain('eligibleWordCount: "출제 검토 통과 {count}개"');
    expect(copy).toContain(
      'activeAssignmentExcluded: "오답 배정 중 {count}개 제외"',
    );
    expect(copy).toContain('maximumQuestionCount: "현재 최대 {count}문항"');
  });

  it("범위를 수정하면 손대지 않은 이전 자동 제목을 새 범위로 갱신한다", () => {
    const manager = source("src/components/assignment-manager.tsx");

    expect(manager).toContain("function resetUntouchedEditTitle()");
    expect(
      manager.match(/resetUntouchedEditTitle\(\);/g)?.length,
    ).toBeGreaterThanOrEqual(3);
    expect(manager).toContain("customTitle === editDraft.title");
    expect(manager).toContain('setCustomTitle("")');
  });
});
