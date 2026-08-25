import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  buildProgress: vi.fn(() => []),
  buildVocabBookHistory: vi.fn(() => []),
  listCurrentWrong: vi.fn(),
  listHistory: vi.fn(),
  listPendingReview: vi.fn(),
  listPointBalances: vi.fn(),
  loadDirectory: vi.fn(),
}));

vi.mock("@/lib/admin/progress", () => ({
  buildStudentProgress: mocks.buildProgress,
}));
vi.mock("@/lib/admin/student-vocab-book-history", () => ({
  buildStudentVocabBookHistory: mocks.buildVocabBookHistory,
}));
vi.mock("@/lib/env", () => ({
  getAppOrigin: () => "https://preview.example.com",
}));
vi.mock("@/lib/services/admin-history-read-service", () => ({
  listAssignmentHistoryBundle: mocks.listHistory,
}));
vi.mock("@/lib/services/admin-student-read-service", () => ({
  listStudentCurrentVocabWrongSummaries: mocks.listCurrentWrong,
  listStudentPendingReviewSummaries: mocks.listPendingReview,
  loadStudentDirectoryBundle: mocks.loadDirectory,
}));
vi.mock("@/lib/services/learning-point-read-service", () => ({
  listStudentPointBalances: mocks.listPointBalances,
}));

import { loadStudentManagementData } from "./load-student-management-data";

describe("loadStudentManagementData", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.loadDirectory.mockResolvedValue({
      allDatasets: [],
      assignmentUnits: [],
      learningSources: [],
      selectableDatasets: [],
      students: [
        { id: "student-a" },
        { id: "student-b" },
        { id: "student-c" },
      ],
    });
    mocks.listHistory.mockResolvedValue({
      completeHistory: [],
      currentHistory: [],
      history: [],
    });
    mocks.listPendingReview.mockResolvedValue([]);
    mocks.listCurrentWrong.mockResolvedValue([]);
    mocks.listPointBalances.mockResolvedValue(new Map([
      ["student-a", 7],
      ["student-b", 0],
      ["student-c", 12],
    ]));
  });

  it("loads every student balance in one call and preserves the ID mapping", async () => {
    const data = await loadStudentManagementData();

    expect(mocks.listPointBalances).toHaveBeenCalledOnce();
    expect(mocks.listPointBalances).toHaveBeenCalledWith([
      "student-a",
      "student-b",
      "student-c",
    ]);
    expect(data.pointBalances).toEqual({
      "student-a": 7,
      "student-b": 0,
      "student-c": 12,
    });
  });
});
