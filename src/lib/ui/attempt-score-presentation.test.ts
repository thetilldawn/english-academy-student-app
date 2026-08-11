import { describe, expect, it } from "vitest";

import {
  buildAttemptScoreSlots,
  buildAttemptStatusPresentation,
  hasAttemptScoreContent,
} from "@/features/history/presentation/attempt-presentation";

describe("buildAttemptScoreSlots", () => {
  it.each([
    {
      name: "응시 전",
      input: { status: "not_started", phase: null },
      expected: { label: "응시 전", tone: "neutral" },
    },
    {
      name: "배정 취소",
      input: { status: "cancelled", phase: null },
      expected: { label: "배정 취소", tone: "neutral" },
    },
    {
      name: "첫 시험 진행 중",
      input: { status: "in_progress", phase: "initial" },
      expected: { label: "응시 중", tone: "neutral" },
    },
    {
      name: "시간 종료",
      input: { status: "expired", phase: "initial" },
      expected: { label: "미통과", tone: "danger" },
    },
  ] as const)("$name 상태를 공통 문구와 색으로 표시한다", ({ input, expected }) => {
    expect(
      buildAttemptStatusPresentation({
        ...input,
        initialScore: null,
        finalScore: null,
        passingScore: 80,
        retryStartedAt: null,
      }),
    ).toMatchObject(expected);
  });

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
      tone: "success",
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
      tone: "danger",
      outcome: "failed",
    });
  });

  it("재시험에서 통과하면 노란 완료로 표시한다", () => {
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
      label: "완료",
      tone: "warning",
      outcome: "retried",
    });
  });

  it("미응시는 미응시, 재시험 선택 전 미달은 미통과로 표시한다", () => {
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
      label: "미응시",
      tone: "danger",
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
      tone: "danger",
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
      tone: "warning",
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

  it("목록용 점수는 점 단위를 생략한다", () => {
    expect(
      buildAttemptScoreSlots(
        {
          status: "completed",
          phase: "completed",
          initialScore: 77.5,
          finalScore: 77.5,
          passingScore: 80,
          retryStartedAt: null,
        },
        { compact: true },
      ),
    ).toEqual([{ label: "최종", value: "77.5", tone: "fail" }, null]);
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

  it("마감된 시험은 이전 고득점이 남아 있어도 실패 색상으로 표시한다", () => {
    expect(
      buildAttemptScoreSlots({
        status: "expired",
        phase: "completed",
        initialScore: 100,
        finalScore: 100,
        passingScore: 80,
        passed: true,
        retryStartedAt: null,
      })[0]?.tone,
    ).toBe("fail");

    expect(
      buildAttemptScoreSlots({
        status: "expired",
        phase: "retry",
        initialScore: 50,
        finalScore: 100,
        passingScore: 80,
        passed: false,
        retryStartedAt: "2026-08-09T01:00:00.000Z",
      }).map((slot) => slot?.tone),
    ).toEqual(["fail", "fail"]);
  });

  it("미응시에는 남아 있는 점수를 노출하지 않는다", () => {
    const input = {
      status: "missed" as const,
      phase: "initial" as const,
      initialScore: 100,
      finalScore: 100,
      passingScore: 80,
      passed: true,
      retryStartedAt: null,
    };

    expect(buildAttemptScoreSlots(input)).toEqual([
      { label: "첫 시험", value: "미응시", tone: "fail" },
      null,
    ]);
    expect(buildAttemptScoreSlots(input, { compact: true })).toEqual([
      null,
      null,
    ]);
    expect(hasAttemptScoreContent(input, { compact: true })).toBe(false);
  });
});
