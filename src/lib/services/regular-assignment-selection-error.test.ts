import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  activeReviewIdentities: vi.fn(() => []),
  createServerSupabaseClient: vi.fn(),
  loadActiveReviewAssignments: vi.fn(),
  loadDatasetDisplayLabel: vi.fn(),
  loadEligibleVocabularyDataset: vi.fn(),
  requireAdmin: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("@/lib/auth/admin", () => ({
  requireAdmin: mocks.requireAdmin,
}));
vi.mock("@/lib/supabase/server", () => ({
  createServerSupabaseClient: mocks.createServerSupabaseClient,
}));
vi.mock("@/lib/services/active-review-assignment-service", () => ({
  activeReviewIdentities: mocks.activeReviewIdentities,
  loadActiveReviewAssignments: mocks.loadActiveReviewAssignments,
}));
vi.mock("@/lib/services/dataset-catalog-service", () => ({
  loadDatasetDisplayLabel: mocks.loadDatasetDisplayLabel,
}));
vi.mock("@/lib/services/eligible-vocabulary-service", () => ({
  loadEligibleVocabularyDataset: mocks.loadEligibleVocabularyDataset,
}));

import {
  calculateRegularAssignmentCapacity,
  loadRegularAssignmentSeriesCandidates,
  prepareRegularAssignment,
  type RegularAssignmentInput,
  type RegularAssignmentPreparationCache,
} from "@/lib/services/regular-assignment-service";

const ids = {
  dataset: "11111111-1111-4111-8111-111111111111",
  student: "22222222-2222-4222-8222-222222222222",
  unit: "33333333-3333-4333-8333-333333333333",
};
const admin = { displayName: "테스트 관리자", userId: "admin-id" };
const input: RegularAssignmentInput = {
  availableUntil: null,
  datasetId: ids.dataset,
  englishToKoreanRatio: 50,
  passingScore: 80,
  questionCount: 4,
  questionOrderMode: "random",
  questionTimeLimitSeconds: null,
  retryEnabled: true,
  retryPassingScore: 80,
  studentIds: [ids.student],
  timeLimitSeconds: 300,
  timingMode: "total",
  title: "",
  unitIds: [ids.unit],
};

function queryClient({
  dataset,
  datasetError = null,
  unitError = null,
  units = [{ id: ids.unit, sort_index: 1, unit_label: "DAY 01" }],
}: {
  dataset: { edition: string | null; id: string; title: string } | null;
  datasetError?: unknown;
  unitError?: unknown;
  units?: { id: string; sort_index: number; unit_label: string }[] | null;
}) {
  const datasetQuery: Record<string, ReturnType<typeof vi.fn>> = {};
  datasetQuery.select = vi.fn(() => datasetQuery);
  datasetQuery.eq = vi.fn(() => datasetQuery);
  datasetQuery.maybeSingle = vi.fn().mockResolvedValue({
    data: dataset,
    error: datasetError,
  });

  const unitQuery: Record<string, ReturnType<typeof vi.fn>> = {};
  unitQuery.select = vi.fn(() => unitQuery);
  unitQuery.eq = vi.fn(() => unitQuery);
  unitQuery.order = vi.fn().mockResolvedValue({
    data: units,
    error: unitError,
  });

  return {
    from: vi.fn((table: string) =>
      table === "vocab_datasets" ? datasetQuery : unitQuery
    ),
  };
}

function cache(client: ReturnType<typeof queryClient>) {
  return {
    activeAssignments: new Map(),
    datasets: new Map(),
    supabase: Promise.resolve(client),
  } as unknown as RegularAssignmentPreparationCache;
}

describe("regular assignment selection errors", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.loadDatasetDisplayLabel.mockResolvedValue("테스트 단어장");
    mocks.loadEligibleVocabularyDataset.mockResolvedValue([]);
  });

  it.each([
    [
      "prepare",
      (preparationCache: RegularAssignmentPreparationCache) =>
        prepareRegularAssignment(input, admin, undefined, preparationCache),
    ],
    [
      "series",
      (preparationCache: RegularAssignmentPreparationCache) =>
        loadRegularAssignmentSeriesCandidates(
          {
            datasetId: ids.dataset,
            studentIds: [ids.student],
            unitIds: [ids.unit],
          },
          admin,
          preparationCache,
        ),
    ],
    [
      "capacity",
      (preparationCache: RegularAssignmentPreparationCache) =>
        calculateRegularAssignmentCapacity(
          {
            datasetId: ids.dataset,
            englishToKoreanRatio: 50,
            studentIds: [ids.student],
            unitIds: [ids.unit],
          },
          admin,
          preparationCache,
        ),
    ],
  ] as const)("%s 조회 실패를 서버 오류로 분류한다", async (_, run) => {
    const client = queryClient({
      dataset: null,
      datasetError: { code: "08006", message: "connection failure" },
    });

    await expect(run(cache(client))).rejects.toEqual(
      expect.objectContaining({ reason: "database" }),
    );
  });

  it("없어진 단어장과 범위를 다시 선택할 입력 오류로 분류한다", async () => {
    const missingDataset = queryClient({ dataset: null });
    await expect(
      prepareRegularAssignment(input, admin, undefined, cache(missingDataset)),
    ).rejects.toEqual(expect.objectContaining({
      reason: "invalid_selection",
    }));

    const staleUnit = queryClient({
      dataset: { edition: null, id: ids.dataset, title: "테스트 단어장" },
      units: [],
    });
    await expect(
      prepareRegularAssignment(input, admin, undefined, cache(staleUnit)),
    ).rejects.toEqual(expect.objectContaining({
      message: "선택한 단어장과 범위를 다시 선택해 주세요.",
      reason: "invalid_selection",
    }));
  });
});
