import { describe, expect, it } from "vitest";

import type { ExamSettings } from "./model";
import {
  advanceDayRangeSelection,
  applyCollisionDecisions,
  applyScheduleSlotOverride,
  applyTimeTemplate,
  buildScheduleSlots,
  buildWeekdayDates,
  copyPreviousExamConditions,
  planUnitSessions,
  resolveDayRange,
  selectInitialVocabDatasetId,
  toggleWeekday,
} from "./vocab-assignment-plan";

const exam: ExamSettings = {
  directionRatio: 50,
  passingScore: 80,
  questionOrderMode: "random",
  timing: { mode: "total", totalSeconds: 300 },
};

describe("단어 시험 공통 배정 계획", () => {
  it("공통 단어장이 명확하지 않으면 첫 자료를 조용히 고르지 않는다", () => {
    const datasets = [{ id: "dataset-a" }, { id: "dataset-b" }];
    expect(selectInitialVocabDatasetId(datasets, "")).toBe("");
    expect(selectInitialVocabDatasetId(datasets, "dataset-b")).toBe(
      "dataset-b",
    );
  });

  it("한국 달력 기준으로 시작일과 종료일 사이 월수금만 만든다", () => {
    expect(buildWeekdayDates({
      startDate: "2026-08-17",
      endDate: "2026-08-23",
      weekdays: [1, 3, 5],
    })).toEqual(["2026-08-17", "2026-08-19", "2026-08-21"]);
  });

  it("1년을 넘는 비정상 날짜 범위는 순회하지 않는다", () => {
    expect(buildWeekdayDates({
      startDate: "2026-01-01",
      endDate: "9999-12-31",
      weekdays: [1, 3, 5],
    })).toEqual([]);
  });

  it("요일을 다시 누르면 해제하고 달력 조건이 잘못되면 빈 후보를 반환한다", () => {
    expect(toggleWeekday([1, 3, 5], 3)).toEqual([1, 5]);
    expect(toggleWeekday([1, 5], 3)).toEqual([1, 3, 5]);
    expect(buildWeekdayDates({
      startDate: "2026-08-23",
      endDate: "2026-08-17",
      weekdays: [1],
    })).toEqual([]);
    expect(buildWeekdayDates({
      startDate: "2026-08-17",
      endDate: "2026-08-17",
      weekdays: [],
    })).toEqual([]);
  });

  it("공개 시각과 다음 날 마감을 회차별 후보로 만든다", () => {
    expect(buildScheduleSlots({
      startDate: "2026-08-17",
      endDate: "2026-08-19",
      weekdays: [1, 3],
      availableTime: "16:00",
      deadlineDayOffset: 1,
      deadlineTime: "22:00",
    })).toEqual([
      {
        sessionNumber: 1,
        date: "2026-08-17",
        availableLocalDateTime: "2026-08-17T16:00",
        deadlineLocalDateTime: "2026-08-18T22:00",
      },
      {
        sessionNumber: 2,
        date: "2026-08-19",
        availableLocalDateTime: "2026-08-19T16:00",
        deadlineLocalDateTime: "2026-08-20T22:00",
      },
    ]);
  });

  it("DAY를 두 번 눌러 역방향 범위를 보존하고 세 번째 선택은 다시 시작한다", () => {
    const units = [1, 2, 3, 4].map((sortIndex) => ({
      id: `day-${sortIndex}`,
      sortIndex,
    }));
    const first = advanceDayRangeSelection(
      { startUnitId: null, endUnitId: null },
      "day-4",
    );
    const second = advanceDayRangeSelection(first, "day-2");
    expect(resolveDayRange(units, second).map((unit) => unit.id)).toEqual([
      "day-4",
      "day-3",
      "day-2",
    ]);
    expect(advanceDayRangeSelection(second, "day-1")).toEqual({
      startUnitId: "day-1",
      endUnitId: null,
    });
  });

  it("범위를 목표 단어 수로 나누거나 모든 날짜에 반복한다", () => {
    const units = [20, 20, 20, 20, 20, 10].map((entryCount, index) => ({
      id: `day-${index + 1}`,
      sortIndex: index + 1,
      entryCount,
    }));
    expect(planUnitSessions({
      orderedUnits: units,
      distribution: "split",
      targetWordsPerSession: 40,
      maximumSessions: 3,
    }).map((session) => session.sourceWordCount)).toEqual([40, 40, 30]);
    expect(planUnitSessions({
      orderedUnits: units,
      distribution: "repeat",
      targetWordsPerSession: 40,
      maximumSessions: 3,
    }).map((session) => session.sourceWordCount)).toEqual([110, 110, 110]);
  });

  it("시간 템플릿 적용과 회차 수정이 원본 템플릿을 바꾸지 않는다", () => {
    const template = {
      id: "after-class",
      label: "수업 후",
      availableTime: "18:00",
      deadlineDayOffset: 1,
      deadlineTime: "14:00",
      timing: { mode: "per_question", perQuestionSeconds: 20 } as const,
    };
    const applied = applyTimeTemplate({
      schedule: {
        startDate: "2026-08-17",
        endDate: "2026-08-21",
        weekdays: [1, 3, 5] as const,
        availableTime: "00:00",
        deadlineDayOffset: 0,
        deadlineTime: "23:59",
      },
      exam,
    }, template);
    const slots = buildScheduleSlots(applied.schedule);
    applied.schedule.availableTime = "19:00";
    expect(template.availableTime).toBe("18:00");
    expect(applied.exam.timing).toEqual({
      mode: "per_question",
      perQuestionSeconds: 20,
    });
    const changed = applyScheduleSlotOverride(slots, 1, {
      availableLocalDateTime: "2026-08-17T20:00",
      deadlineLocalDateTime: "2026-08-18T21:00",
    });
    expect(changed[0]?.availableLocalDateTime).toBe("2026-08-17T20:00");
    expect(changed[1]).toEqual(slots[1]);
    expect(slots[0]?.availableLocalDateTime).toBe("2026-08-17T18:00");
    expect(template.availableTime).toBe("18:00");
  });

  it("직전 시험 복사는 시험 조건만 바꾸고 대상과 날짜와 범위는 유지한다", () => {
    const draft = {
      studentIds: ["student-new"],
      date: "2026-08-21",
      unitIds: ["day-new"],
      exam,
    };
    const copied = copyPreviousExamConditions(draft, {
      directionRatio: 100,
      passingScore: 90,
      questionOrderMode: "ascending",
      timing: { mode: "total", totalSeconds: 600 },
    });
    expect(copied.studentIds).toEqual(["student-new"]);
    expect(copied.date).toBe("2026-08-21");
    expect(copied.unitIds).toEqual(["day-new"]);
    expect(copied.exam.passingScore).toBe(90);
  });

  it("겹침 결정은 새 후보만 건너뛰거나 이동하고 기존 자료는 건드리지 않는다", () => {
    const candidates = [
      {
        id: "candidate-1",
        studentId: "student-1",
        sessionNumber: 1,
        date: "2026-08-17",
        unitIds: ["day-1"],
      },
      {
        id: "candidate-2",
        studentId: "student-1",
        sessionNumber: 2,
        date: "2026-08-19",
        unitIds: ["day-2"],
      },
    ];
    const collisions = [
      {
        id: "collision-1",
        candidateId: "candidate-1",
        existingAssignmentId: "existing-1",
        message: "같은 날 시험 있음",
      },
      {
        id: "collision-2",
        candidateId: "candidate-2",
        existingAssignmentId: "existing-2",
        message: "같은 날 시험 있음",
      },
    ];
    const before = structuredClone(collisions);
    const result = applyCollisionDecisions({
      candidates,
      collisions,
      decisions: [
        { collisionId: "collision-1", mode: "skip" },
        {
          collisionId: "collision-2",
          mode: "move",
          movedDate: "2026-08-20",
        },
      ],
    });
    expect(result.candidates).toHaveLength(1);
    expect(result.candidates[0]?.date).toBe("2026-08-20");
    expect(result.skippedCandidateIds).toEqual(["candidate-1"]);
    expect(collisions).toEqual(before);
  });
});
