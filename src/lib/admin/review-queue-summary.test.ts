import { describe, expect, it } from "vitest";

import {
  availableReviewCount,
  emptyPendingReviewCounts,
  indexStudentPendingReviewSummaries,
  parseStudentPendingReviewSummaries,
  pendingReviewCount,
  pendingReviewSummaryKey,
  reservedReviewCount,
} from "@/lib/admin/review-queue-summary";

describe("parseStudentPendingReviewSummaries", () => {
  it("DB 정수와 정수 문자열을 안전한 요약으로 바꾼다", () => {
    expect(
      parseStudentPendingReviewSummaries([
        {
          student_id: "student-1",
          dataset_id: "dataset-1",
          pending_level_1_count: 3,
          pending_level_2_count: "2",
          reserved_level_1_count: 1,
          reserved_level_2_count: "0",
        },
      ]),
    ).toEqual([
      {
        studentId: "student-1",
        datasetId: "dataset-1",
        pendingLevel1Count: 3,
        pendingLevel2Count: 2,
        reservedLevel1Count: 1,
        reservedLevel2Count: 0,
      },
    ]);
  });

  it("음수·소수·전체보다 큰 예약 수를 거절한다", () => {
    for (const invalidCount of [-1, 1.5, "not-a-number"]) {
      expect(() =>
        parseStudentPendingReviewSummaries([
          {
            student_id: "student-1",
            dataset_id: "dataset-1",
            pending_level_1_count: invalidCount,
            pending_level_2_count: 0,
            reserved_level_1_count: 0,
            reserved_level_2_count: 0,
          },
        ]),
      ).toThrow();
    }
    expect(() =>
      parseStudentPendingReviewSummaries([
        {
          student_id: "student-1",
          dataset_id: "dataset-1",
          pending_level_1_count: 1,
          pending_level_2_count: 0,
          reserved_level_1_count: 2,
          reserved_level_2_count: 0,
        },
      ]),
    ).toThrow("전체 대기 수");
  });
});

describe("indexStudentPendingReviewSummaries", () => {
  const summaries = [
    {
      studentId: "student-1",
      datasetId: "dataset-1",
      pendingLevel1Count: 3,
      pendingLevel2Count: 2,
      reservedLevel1Count: 1,
      reservedLevel2Count: 0,
    },
    {
      studentId: "student-1",
      datasetId: "dataset-2",
      pendingLevel1Count: 0,
      pendingLevel2Count: 4,
      reservedLevel1Count: 0,
      reservedLevel2Count: 2,
    },
  ];

  it("학생·단어장별 수와 학생 전체 수를 따로 색인한다", () => {
    const index = indexStudentPendingReviewSummaries(summaries);

    expect(
      index.byStudentDataset.get(
        pendingReviewSummaryKey("student-1", "dataset-1"),
      ),
    ).toEqual({
      pendingLevel1Count: 3,
      pendingLevel2Count: 2,
      reservedLevel1Count: 1,
      reservedLevel2Count: 0,
    });
    expect(index.byStudent.get("student-1")).toEqual({
      pendingLevel1Count: 3,
      pendingLevel2Count: 6,
      reservedLevel1Count: 1,
      reservedLevel2Count: 2,
    });
  });

  it("표시는 예약 포함, 혼합시험 가능 수는 예약 제외로 계산한다", () => {
    const counts =
      indexStudentPendingReviewSummaries(summaries).byStudent.get(
        "student-1",
      ) ?? emptyPendingReviewCounts();

    expect(pendingReviewCount(counts)).toBe(9);
    expect(reservedReviewCount(counts)).toBe(3);
    expect(availableReviewCount(counts)).toBe(6);
    expect(availableReviewCount(counts, [2])).toBe(4);
  });
});
