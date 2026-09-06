import { beforeEach, describe, expect, it, vi } from "vitest";

import { cataloguedDatasetFromMetadata } from "@/lib/admin/dataset-catalog";
import { getAssignmentPlannerPreparation } from "./assignment-planner-preparation-query";

const mocks = vi.hoisted(() => ({
  material: vi.fn(),
  rpc: vi.fn(),
  requireAdmin: vi.fn(),
  from: vi.fn(),
  currentDatasetId: null as string | null,
  unitError: null as null | { message: string },
  studentIds: [] as string[],
}));
vi.mock("server-only", () => ({}));
vi.mock("@/lib/auth/admin", () => ({ requireAdmin: mocks.requireAdmin }));
vi.mock("@/lib/services/admin-material-read-service", () => ({ loadAdminMaterialSnapshot: mocks.material }));
vi.mock("@/lib/services/vocab-time-template-service", () => ({ listVocabTimeTemplates: async () => [] }));
vi.mock("@/lib/supabase/server", () => ({
  createServerSupabaseClient: async () => ({
    rpc: mocks.rpc,
    from: mocks.from,
  }),
}));

const datasets = ["ready", "meaning-only"].map((id) => ({
  ...cataloguedDatasetFromMetadata({ id, title: `가짜 단어장 ${id}` }, undefined),
  datasetKey: id, rowCount: 20, status: "ready" as const, isActive: true,
}));

describe("배정 준비의 출제 유형 연결", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.currentDatasetId = null;
    mocks.unitError = null;
    mocks.from.mockImplementation((table: string) => {
      if (table === "students") return { select: () => ({ in: (_key: string, studentIds: string[]) => {
        mocks.studentIds = studentIds;
        return { is: async () => ({ error: null, data: studentIds.map((id) => ({
          id, display_name: "가짜 학생", status: "active", school_name: null,
          grade_label: null, current_vocab_book: null, current_vocab_dataset_id: mocks.currentDatasetId,
        })) }) };
      } }) };
      if (table === "vocab_units") return { select: () => ({ eq: () => ({ order: async () => ({ data: [], error: mocks.unitError }) }) }) };
      throw new Error("준비 자료를 중복 조회했습니다: " + table);
    });
    mocks.requireAdmin.mockResolvedValue({ userId: "fake-admin" });
    mocks.material.mockResolvedValue({ allDatasets: datasets, datasetLabelById: new Map() });
    mocks.rpc.mockResolvedValue({ error: null, data: [{
      dataset_id: "ready", definition_count: "68", example_count: "49",
    }] });
  });

  it.each([["single", ["fake-1"]], ["bulk", ["fake-1", "fake-2"]]] as const)(
    "%s 신규 배정은 승인 문항이 있는 같은 세 유형을 전달한다", async (_mode, studentIds) => {
      const result = await getAssignmentPlannerPreparation(studentIds);
      expect(mocks.requireAdmin).toHaveBeenCalledOnce();
      expect(mocks.rpc).toHaveBeenCalledExactlyOnceWith("list_assignment_question_mode_availability_v1");
      expect(result.students.map((item) => item.id)).toEqual(studentIds);
      expect(result.datasets[0]?.availableQuestionModes).toEqual([
        "book_meaning_choice", "canonical_definition_to_headword", "canonical_example_to_headword",
      ]);
      expect(result.datasets[1]?.availableQuestionModes).toEqual(["book_meaning_choice"]);
    },
  );

  it("출제 유형 조회 실패를 검토 중이나 준비 문항 0개로 반환하지 않는다", async () => {
    mocks.rpc.mockResolvedValue({ data: null, error: { message: "fake read failure" } });
    await expect(getAssignmentPlannerPreparation(["fake-1"]))
      .rejects.toThrow("시험 유형 준비 상태를 불러오지 못했습니다.");
  });
  it.each(["explicit", "automatic"])("%s 선택은 이미 읽은 단어장으로 정상 빈 범위를 읽으며 중복조회하지 않는다", async (mode) => {
    if (mode === "automatic") mocks.currentDatasetId = "ready";
    const result = await getAssignmentPlannerPreparation(["fake-1"], mode === "explicit" ? "ready" : "");
    expect(result.initialDatasetId).toBe("ready"); expect(result.initialUnits).toEqual([]);
    expect(mocks.material).toHaveBeenCalledOnce(); expect(mocks.requireAdmin).toHaveBeenCalledOnce();
    expect(mocks.from.mock.calls.map(([table]) => table)).toEqual(["students", "vocab_units"]);
  });
  it.each(["missing", "not-ready", "inactive", "unassignable"])("명시 %s 단어장은 거절하고 범위를 읽지 않는다", async (kind) => {
    const invalid = { ...datasets[0], ...(kind === "not-ready" ? { status: "pending_review" } : kind === "inactive" ? { isActive: false } : kind === "unassignable" ? { isAssignable: false } : {}) };
    mocks.material.mockResolvedValue({ allDatasets: kind === "missing" ? [] : [invalid], datasetLabelById: new Map() });
    await expect(getAssignmentPlannerPreparation(["fake-1"], "ready")).rejects.toMatchObject({ reason: "invalid_dataset" });
    expect(mocks.from).not.toHaveBeenCalledWith("vocab_units");
  });
  it("자동선택할 유효 단어장이 없으면 미선택이며 임의 빈범위 조회를 하지 않는다", async () => {
    mocks.currentDatasetId = "gone";
    const result = await getAssignmentPlannerPreparation(["fake-1"]);
    expect(result.initialDatasetId).toBe(""); expect(result.initialUnits).toEqual([]);
    expect(mocks.from).not.toHaveBeenCalledWith("vocab_units");
  });
  it("준비 단위 조회 오류도 정상 빈 범위로 바꾸지 않는다", async () => {
    mocks.unitError = { message: "private SQL" };
    await expect(getAssignmentPlannerPreparation(["fake-1"], "ready")).rejects.toMatchObject({ reason: "unavailable" });
  });
  it("권한 거절은 준비자료와 DB 읽기 전에 중단한다", async () => {
    mocks.requireAdmin.mockRejectedValue(new Error("denied"));
    await expect(getAssignmentPlannerPreparation(["fake-1"], "ready")).rejects.toThrow("denied");
    expect(mocks.material).not.toHaveBeenCalled(); expect(mocks.from).not.toHaveBeenCalled();
  });
});
