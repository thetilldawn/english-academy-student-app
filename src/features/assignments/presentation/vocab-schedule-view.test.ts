import { describe, expect, it } from "vitest";
import { cataloguedDatasetFromMetadata } from "@/lib/admin/dataset-catalog";
import type { AssignmentDatasetItem } from "../catalog-types";
import { vocabScheduleLabels, vocabScheduleSessionRows } from "./vocab-schedule-view";

describe("일정 표시 변환", () => {
  const previewSessions = Object.freeze([
    Object.freeze({ sessionNumber: 1, availableFrom: "2026-09-07T07:00:00Z", availableUntil: "2026-09-07T13:00:00Z", questionCount: 20 }),
    Object.freeze({ sessionNumber: 2, availableFrom: "2026-09-08T07:00:00Z", availableUntil: "2026-09-08T13:00:00Z", questionCount: 10 }),
  ]);
  const base = { slots: [], previewSessions, hasSelectedWeekdays: true,
    distribution: "split" as const, availableTimeEnabled: true };

  it("현재 단어장이 이전 미리보기보다 우선이고 역순 단원도 입력 순서대로 표시한다", () => {
    const selectedDataset = { ...cataloguedDatasetFromMetadata({ id: "fake-book", title: "선택 단어장" }, undefined),
      isActive: true, rowCount: 40, status: "ready" } as AssignmentDatasetItem;
    const selectedUnits = Object.freeze([
      Object.freeze({ label: "DAY 2", sortIndex: 2 }), Object.freeze({ label: "DAY 1", sortIndex: 1 }),
    ]);
    expect(vocabScheduleLabels({ selectedDataset, representativeDatasetLabel: "이전 단어장", selectedUnits }))
      .toEqual({ datasetLabel: "선택 단어장", rangeLabel: "DAY 2~DAY 1" });
    expect(selectedUnits[0]!.label).toBe("DAY 2");
  });

  it("미선택과 미리보기 대체 라벨을 구분한다", () => {
    expect(vocabScheduleLabels({ selectedUnits: [] }))
      .toEqual({ datasetLabel: "단어장 미선택", rangeLabel: "범위 미선택" });
    expect(vocabScheduleLabels({ selectedUnits: [], representativeDatasetLabel: "계산 단어장" }).datasetLabel)
      .toBe("계산 단어장");
  });

  it("요일을 고르기 전 계산용 미리보기 날짜는 숨긴다", () => {
    expect(vocabScheduleSessionRows({ ...base, hasSelectedWeekdays: false })).toEqual([]);
  });

  it("편집한 시간은 미리보기보다 우선하며 표시 오류와 다음 회차를 분리한다", () => {
    const slots = Object.freeze([Object.freeze({ sessionNumber: 1, date: "2026-09-07",
      availableLocalDateTime: "2026-09-07T17:00", deadlineLocalDateTime: "2026-09-07T23:00" })]);
    const rows = vocabScheduleSessionRows({ ...base, slots, fieldErrors: { "session-1-deadline": "마감 시각을 확인해 주세요." } });
    expect(rows[0]).toMatchObject({ label: "1회차 [9월 7일 (월)] 20개", editable: true, queued: false,
      availableLocalDateTime: "2026-09-07T17:00", deadlineLocalDateTime: "2026-09-07T23:00",
      deadlineError: "마감 시각을 확인해 주세요." });
    expect(rows[1]).toMatchObject({ label: "2회차 [9월 8일 (화)] 10개", editable: false, queued: true,
      generatedTimeLabel: "공개 16:00 / 마감 2026-09-08 22:00" });
    expect(slots).toHaveLength(1);
  });

  it("날짜 없는 값은 임의 날짜로 바꾸지 않고 반복 배정에는 대기 배지를 붙이지 않는다", () => {
    const rows = vocabScheduleSessionRows({ ...base, distribution: "repeat", availableTimeEnabled: false,
      previewSessions: [{ sessionNumber: 1, availableFrom: null, availableUntil: null, questionCount: 4 }] });
    expect(rows[0]).toMatchObject({ editable: false, queued: false, availableLocalDateTime: "", deadlineLocalDateTime: "", generatedTimeLabel: "즉시 공개" });
  });
});
