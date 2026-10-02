import { describe, expect, it } from "vitest";
import { mixedMistakePreviewInputSchema, mixedMistakeSaveSchema, mixedMistakePreviewSchema, mixedMistakeResultSchema } from "./mixed-mistake-assignment";
const id = (n: number) => `a3090000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const input = { planVersion: "meaning-episode-v1", studentId: id(1), datasetId: id(2), primaryUnitIds: [id(3)], reviewLevels: [1, 2],
  englishToKoreanRatio: 50, totalQuestionCount: 4, timeLimitSeconds: 60, passingScore: 80, retryEnabled: true, retryPassingScore: 80, availableUntil: null };
const preview = { planVersion: "meaning-episode-v1", selectionFingerprint: "a".repeat(64), totalQuestionCount: 4, primaryQuestionCount: 1,
  reviewMeaningCount: 3, availablePrimaryCount: 5, candidateReviewCount: 3, unavailableCount: 0, unavailableItems: [], error: null,
  banks: [{ index: 0, questionCount: 4, primaryQuestionCount: 1, reviewMeaningCount: 3, quizContentMode: "book_meaning_choice", englishToKoreanRatio: 50, timeLimitSeconds: 60 }] };
describe("뜻별 혼합 배정 계약", () => {
  it("미리보기 설정과 저장 확인값을 분리하며 버전·기존 초안·위조 문항을 검증한다", () => {
    expect(mixedMistakePreviewInputSchema.parse(input)).toMatchObject({ timingMode: "total", reviewScope: "dataset" });
    const save = { ...input, idempotencyKey: id(4), selectionFingerprint: "a".repeat(64), excludeUnavailableConfirmed: false, banksConfirmed: false };
    expect(mixedMistakeSaveSchema.safeParse(save).success).toBe(true);
    for (const name of ["planVersion", "selectionFingerprint", "idempotencyKey", "banksConfirmed", "excludeUnavailableConfirmed"]) {
      const bad = { ...save } as Record<string, unknown>; delete bad[name];
      expect(mixedMistakeSaveSchema.safeParse(bad).success).toBe(false);
    }
    for (const extra of [{ draftId: id(9) }, { questions: [] }, { sourceQuestionId: id(8) }, { bankCount: 1 }]) {
      expect(mixedMistakeSaveSchema.safeParse({ ...save, ...extra }).success).toBe(false);
    }
  });
  it("원래 시간·재시험·범위의 검증을 유지한다", () => {
    for (const change of [{ primaryUnitIds: [id(3), id(3)] }, { reviewLevels: [1, 1] }, { totalQuestionCount: 3 },
      { retryEnabled: false }, { timingMode: "per_question" }, { timingMode: "none", questionTimeLimitSeconds: 10 }]) {
      expect(mixedMistakePreviewInputSchema.safeParse({ ...input, ...change }).success).toBe(false);
    }
  });
  it("다중 시험의 실제 문항 수와 확인값을 검증하며 불완전한 성공을 받지 않는다", () => {
    expect(mixedMistakePreviewSchema.safeParse(preview).success).toBe(true);
    for (const change of [{ selectionFingerprint: null }, { banks: [] }, { primaryQuestionCount: 2 }, { reviewMeaningCount: 2 },
      { banks: [{ ...preview.banks[0], index: 1 }] }, { banks: [{ ...preview.banks[0], reviewMeaningCount: 2 }] }]) {
      expect(mixedMistakePreviewSchema.safeParse({ ...preview, ...change }).success).toBe(false);
    }
    expect(mixedMistakePreviewSchema.safeParse({ ...preview, error: "방향을 조정해 주세요.", selectionFingerprint: null, banks: [] }).success).toBe(true);
    expect(mixedMistakePreviewSchema.safeParse({ ...preview, error: "잘못된 구성" }).success).toBe(false);
  });
  it("같은 학생의 서로 다른 시험 결과만 수락한다", () => {
    const result = { planVersion: "meaning-episode-v1", kind: "mistake_batch", assignments: [
      { studentId: id(1), assignmentId: id(6), questionCount: 3 }, { studentId: id(1), assignmentId: id(7), questionCount: 1 }] };
    expect(mixedMistakeResultSchema.safeParse(result).success).toBe(true);
    expect(mixedMistakeResultSchema.safeParse({ ...result, assignments: [result.assignments[0], result.assignments[0]] }).success).toBe(false);
    expect(mixedMistakeResultSchema.safeParse({ ...result, assignments: [result.assignments[0], { ...result.assignments[1], studentId: id(9) }] }).success).toBe(false);
    expect(mixedMistakeResultSchema.safeParse({ assignmentId: id(6) }).success).toBe(false);
  });
});
