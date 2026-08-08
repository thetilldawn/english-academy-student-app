import { describe, expect, it } from "vitest";

import {
  buildAttemptScoreSlots,
  buildAttemptStatusPresentation,
} from "@/lib/ui/attempt-score-presentation";

describe("buildAttemptScoreSlots", () => {
  it("한 번에 끝난 시험은 중복 점수 없이 최종만 표시한다", () => {
    expect(
      buildAttemptScoreSlots({
        status: "completed",
        phase: "completed",
        initialScore: 100,
        finalScore: 100,
        passingScore: 80,
        retryStartedAt: null,
      }),
    ).toEqual([
      { label: "최종", value: "100점", tone: "pass" },
      null,
    ]);
  });

  it("첫 시험 통과는 완료, 점수 미달은 미통과로 표시한다", () => {
    expect(
      buildAttemptStatusPresentation({
        status: "completed",
        phase: "completed",
        initialScore: 100,
        finalScore: 100,
        passingScore: 80,
        retryStartedAt: null,
      }),
    ).toMatchObject({
      label: "완료",
      className: "status-completed",
      outcome: "completed",
    });

    expect(
      buildAttemptStatusPresentation({
        status: "completed",
        phase: "completed",
        initialScore: 25,
        finalScore: 25,
        passingScore: 80,
        retryStartedAt: "2026-08-06T01:00:00.000Z",
      }),
    ).toMatchObject({
      label: "미통과",
      className: "status-failed",
      outcome: "failed",
    });
  });

  it("실제로 시작한 재시험은 결과와 무관하게 재시험으로 구분한다", () => {
    expect(
      buildAttemptStatusPresentation({
        status: "completed",
        phase: "completed",
        initialScore: 75,
        finalScore: 100,
        passingScore: 80,
        retryStartedAt: "2026-08-06T01:00:00.000Z",
      }),
    ).toMatchObject({
      label: "재시험",
      className: "status-retried",
      outcome: "retried",
    });
  });

  it("미응시와 재시험 선택 전 미달은 미통과로 표시한다", () => {
    expect(
      buildAttemptStatusPresentation({
        status: "missed",
        phase: null,
        initialScore: null,
        finalScore: null,
        passingScore: 80,
        retryStartedAt: null,
      }),
    ).toMatchObject({
      label: "미통과",
      className: "status-failed",
      outcome: "missed",
    });

    expect(
      buildAttemptStatusPresentation({
        status: "in_progress",
        phase: "review",
        initialScore: 50,
        finalScore: 50,
        passingScore: 80,
        retryStartedAt: null,
      }),
    ).toMatchObject({
      label: "미통과",
      className: "status-failed",
      outcome: "failed",
    });
  });

  it("진행 중인 실제 재시험도 재시험으로 표시한다", () => {
    expect(
      buildAttemptStatusPresentation({
        status: "in_progress",
        phase: "retry",
        initialScore: 50,
        finalScore: 50,
        passingScore: 80,
        retryStartedAt: "2026-08-06T01:00:00.000Z",
      }),
    ).toMatchObject({
      label: "재시험",
      className: "status-retried",
      outcome: "retried",
    });
  });

  it("실제 재시험은 첫 시험과 재시험을 분리한다", () => {
    expect(
      buildAttemptScoreSlots({
        status: "completed",
        phase: "completed",
        initialScore: 60,
        finalScore: 90,
        passingScore: 80,
        retryStartedAt: "2026-08-06T01:00:00.000Z",
      }),
    ).toEqual([
      { label: "첫 시험", value: "60점", tone: "fail" },
      { label: "재시험", value: "90점", tone: "pass" },
    ]);
  });

  it("0점과 미응시는 실패 색상으로 표시한다", () => {
    expect(
      buildAttemptScoreSlots({
        status: "completed",
        phase: "completed",
        initialScore: 0,
        finalScore: 0,
        passingScore: 80,
        retryStartedAt: null,
      })[0]?.tone,
    ).toBe("fail");

    expect(
      buildAttemptScoreSlots({
        status: "missed",
        phase: null,
        initialScore: null,
        finalScore: null,
        passingScore: 80,
        retryStartedAt: null,
      })[0],
    ).toEqual({ label: "첫 시험", value: "미응시", tone: "fail" });
  });

  it("점수가 없는 취소 배정도 첫 번째 점수 칸에 맞춘다", () => {
    expect(
      buildAttemptScoreSlots({
        status: "cancelled",
        phase: null,
        initialScore: null,
        finalScore: null,
        passingScore: 80,
        retryStartedAt: null,
      }),
    ).toEqual([{ label: "점수", value: "-", tone: "neutral" }, null]);
  });
});
