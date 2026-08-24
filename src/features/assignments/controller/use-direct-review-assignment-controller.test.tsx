// @vitest-environment jsdom

import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import type {
  AssignmentDatasetItem,
  AssignmentStudentItem,
  AssignmentUnitItem,
} from "../catalog-types";
import type { AssignmentTransport } from "../transport/assignment-transport";
import { useDirectReviewAssignmentController } from "./use-direct-review-assignment-controller";

const ids = {
  assignment: "00000000-0000-4000-8000-000000000010",
  dataset: "00000000-0000-4000-8000-000000000020",
  student: "00000000-0000-4000-8000-000000000030",
  unit: "00000000-0000-4000-8000-000000000040",
  idempotency: "00000000-0000-4000-8000-000000000050",
} as const;

const dataset: AssignmentDatasetItem = {
  academicYear: null,
  catalogGroup: "middle",
  catalogSortIndex: 1,
  curriculumRevision: null,
  displayName: "테스트 단어장",
  edition: null,
  editionLabel: null,
  gradeCode: null,
  id: ids.dataset,
  isActive: true,
  isAssignable: true,
  materialKind: "wordbook",
  publisher: null,
  rowCount: 100,
  seriesTitle: null,
  status: "ready",
  title: "테스트 단어장",
};

const student: AssignmentStudentItem = {
  currentVocabBook: "테스트 단어장",
  currentVocabDatasetId: ids.dataset,
  displayName: "가짜 학생",
  gradeLabel: "중1",
  id: ids.student,
  schoolName: "가짜중",
  status: "active",
};

const unit: AssignmentUnitItem = {
  academicYear: null,
  agency: null,
  catalogGroup: "middle",
  catalogSortIndex: 1,
  datasetId: ids.dataset,
  displayName: "DAY 1",
  entryCount: 100,
  examMonth: null,
  id: ids.unit,
  itemRange: null,
  kind: "day",
  label: "DAY 1",
  number: 1,
  sortIndex: 1,
  unitType: "day",
};

const summaryResponse = {
  summaries: [{
    datasetId: ids.dataset,
    latestWrongAt: "2026-08-24T01:00:00.000Z",
    level1Count: 1,
    level2Count: 1,
    totalCount: 2,
  }],
};

const capacityResponse = {
  activeAssignmentExcluded: 0,
  alreadyAssigned: 0,
  eligibleBeforeActiveAssignment: 100,
  maximumQuestionCount: 2,
  minimumQuestionCount: 2,
  overlap: 2,
  questionPlanExcluded: 0,
  recommendedQuestionCount: 2,
  unitEligible: 100,
  wrongEligible: 2,
  wrongLevel1Eligible: 1,
  wrongLevel2Eligible: 1,
};

afterEach(() => {
  vi.restoreAllMocks();
});

describe("direct review assignment controller", () => {
  it("오답 탭을 열 때만 요약을 한 번 읽고 현재 오답으로 계산한다", async () => {
    const requests: Parameters<AssignmentTransport>[0][] = [];
    const transport: AssignmentTransport = vi.fn(async (request) => {
      requests.push(request);
      if (request.url.endsWith("/direct-review-summaries")) {
        return { data: summaryResponse, ok: true, status: 200 };
      }
      return { data: capacityResponse, ok: true, status: 200 };
    });
    const { result, rerender } = renderHook(
      ({ enabled }) => useDirectReviewAssignmentController({
        datasets: [dataset],
        enabled,
        initialDatasetId: ids.dataset,
        student,
        transport,
        units: [unit],
      }),
      { initialProps: { enabled: false } },
    );

    await act(async () => Promise.resolve());
    expect(transport).not.toHaveBeenCalled();

    rerender({ enabled: true });
    await waitFor(() => expect(result.current.canSubmit).toBe(true));

    expect(
      requests.filter((request) =>
        request.url.endsWith("/direct-review-summaries")
      ),
    ).toHaveLength(1);
    expect(requests.find((request) =>
      request.url === "/api/admin/assignment-capacity"
    )).toMatchObject({
      body: {
        includePendingReview: true,
        reviewLevels: [1, 2],
        reviewSource: "current_wrong",
      },
      method: "POST",
    });
    expect(result.current.draft.questionCount).toBe(2);

    rerender({ enabled: true });
    await act(async () => Promise.resolve());
    expect(
      requests.filter((request) =>
        request.url.endsWith("/direct-review-summaries")
      ),
    ).toHaveLength(1);
  });

  it("저장 재시도에는 같은 멱등키를 사용한다", async () => {
    vi.spyOn(globalThis.crypto, "randomUUID").mockReturnValue(
      ids.idempotency,
    );
    const exactBodies: Record<string, unknown>[] = [];
    const transport: AssignmentTransport = vi.fn(async (request) => {
      if (request.url.endsWith("/direct-review-summaries")) {
        return { data: summaryResponse, ok: true, status: 200 };
      }
      if (request.url === "/api/admin/assignment-capacity") {
        return { data: capacityResponse, ok: true, status: 200 };
      }
      exactBodies.push(request.body as Record<string, unknown>);
      return exactBodies.length === 1
        ? { data: { error: "일시 오류" }, ok: false, status: 503 }
        : {
            data: { assignmentId: ids.assignment },
            ok: true,
            status: 201,
          };
    });
    const { result } = renderHook(() =>
      useDirectReviewAssignmentController({
        datasets: [dataset],
        enabled: true,
        initialDatasetId: ids.dataset,
        student,
        transport,
        units: [unit],
      }),
    );
    await waitFor(() => expect(result.current.canSubmit).toBe(true));

    await act(async () => {
      expect(await result.current.actions.submit()).toMatchObject({
        ok: false,
      });
    });
    await act(async () => {
      expect(await result.current.actions.submit()).toMatchObject({
        ok: true,
      });
    });

    expect(exactBodies).toHaveLength(2);
    expect(exactBodies[0]?.idempotencyKey).toBe(ids.idempotency);
    expect(exactBodies[1]?.idempotencyKey).toBe(ids.idempotency);
  });

  it("400개 제한으로 이번 후보에 없는 단계도 전체 요약에 남으면 유지한다", async () => {
    const transport: AssignmentTransport = vi.fn(async (request) => {
      if (request.url.endsWith("/direct-review-summaries")) {
        return {
          data: {
            summaries: [{
              ...summaryResponse.summaries[0],
              level1Count: 5,
              level2Count: 400,
              totalCount: 405,
            }],
          },
          ok: true,
          status: 200,
        };
      }
      return {
        data: {
          ...capacityResponse,
          maximumQuestionCount: 400,
          minimumQuestionCount: 400,
          recommendedQuestionCount: 400,
          wrongEligible: 400,
          wrongLevel1Eligible: 0,
          wrongLevel2Eligible: 400,
        },
        ok: true,
        status: 200,
      };
    });
    const { result } = renderHook(() =>
      useDirectReviewAssignmentController({
        datasets: [dataset],
        enabled: true,
        initialDatasetId: ids.dataset,
        student,
        transport,
        units: [unit],
      }),
    );

    await waitFor(() => expect(result.current.canSubmit).toBe(true));

    expect(result.current.knownLevelCounts).toEqual({
      level1: 5,
      level2: 400,
    });
    expect(result.current.draft.reviewLevels).toEqual([1, 2]);
    expect(result.current.draft.questionCount).toBe(400);
  });
});
