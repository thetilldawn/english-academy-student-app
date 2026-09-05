import { describe, expect, it } from "vitest";
import { cataloguedDatasetFromMetadata } from "@/lib/admin/dataset-catalog";
import type { AssignmentDatasetItem } from "../catalog-types";
import {
  EMPTY_DATASET_FILTERS,
  rememberDatasetSelection, sanitizeRecentDatasetIds, splitRecentDatasetOptions,
} from "./assignment-dataset-picker";
import { datasetPickerFilterButtons, datasetPickerStage, filterDatasetPickerOptions } from "../presentation/assignment-dataset-picker-view";

function book(id: string, title: string, fields: Partial<AssignmentDatasetItem> = {}) {
  return { dataset: {
    ...cataloguedDatasetFromMetadata({ id, title }, undefined),
    isActive: true, rowCount: 100, status: "ready" as const, ...fields,
  } };
}
const options = [
  book("a", "[심석 고1] 2-1 필수 형용사 500", { materialKind: "wordbook", gradeCode: "g10" }),
  book("b", "공통영어Ⅱ 오선영 1과", { materialKind: "textbook", gradeCode: "g10", publisher: "교학사", curriculumRevision: "2022" }),
  book("c", "중등 VOCA", { materialKind: "wordbook", catalogGroup: "middle", gradeCode: "M2" }),
  book("d", "9월 모의고사", { materialKind: "exam_collection", catalogGroup: "high_mock", gradeCode: "g12", academicYear: 2025 }),
  book("e", "고1이라는 제목만 있는 미분류"),
];
const ids = (values: typeof options) => values.map(({ dataset }) => dataset.id);

describe("단어장 검색과 분류", () => {
  it("공백·대소문자·호환 문자를 정규화하고 모든 검색어를 함께 찾는다", () => {
    expect(ids(filterDatasetPickerOptions(options, { ...EMPTY_DATASET_FILTERS, query: "  심석   형용사  " }))).toEqual(["a"]);
    expect(ids(filterDatasetPickerOptions(options, { ...EMPTY_DATASET_FILTERS, query: "ｖｏｃａ" }))).toEqual(["c"]);
    expect(ids(filterDatasetPickerOptions(options, { ...EMPTY_DATASET_FILTERS, query: "공통영어II 교학사 2022" }))).toEqual(["b"]);
    expect(ids(filterDatasetPickerOptions(options, { ...EMPTY_DATASET_FILTERS, query: "2025 9월" }))).toEqual(["d"]);
  });
  it("학교급·자료 종류·학년은 서로 다른 조건으로 결합한다", () => {
    expect(ids(filterDatasetPickerOptions(options, { ...EMPTY_DATASET_FILTERS, stage: "high", kind: "wordbook" }))).toEqual(["a"]);
    expect(ids(filterDatasetPickerOptions(options, { ...EMPTY_DATASET_FILTERS, stage: "high", grade: "g12" }))).toEqual(["d"]);
    expect(filterDatasetPickerOptions(options, { ...EMPTY_DATASET_FILTERS, stage: "middle", kind: "textbook" })).toEqual([]);
  });
  it("누락 메타데이터의 고등 기본값이나 제목으로 학교급을 지어내지 않는다", () => {
    expect(datasetPickerStage(options[4]!.dataset)).toBe("unclassified");
    expect(filterDatasetPickerOptions(options, EMPTY_DATASET_FILTERS)).toHaveLength(5);
    expect(ids(filterDatasetPickerOptions(options, { ...EMPTY_DATASET_FILTERS, stage: "unclassified" }))).toEqual(["e"]);
  });
  it("분류 개수는 다른 조건을 반영하고 표시하지 않는 종류를 만들어내지 않는다", () => {
    const buttons = datasetPickerFilterButtons(options, { ...EMPTY_DATASET_FILTERS, kind: "wordbook" });
    expect(buttons.stage.find((option) => option.value === "middle")?.count).toBe(1);
    expect(buttons.kind.some((option) => option.value === "supplement")).toBe(false);
    expect(buttons.grade.map((option) => option.value)).toEqual(["all", "g8", "g10", "g12"]);
    expect(buttons.grade.map((option) => option.label)).toEqual(["전체", "중2", "고1", "고3"]);
  });
  it("최근 선택은 현재 후보·검색 결과와의 교집합이고 전체 목록에 중복하지 않는다", () => {
    const filtered = filterDatasetPickerOptions(options, { ...EMPTY_DATASET_FILTERS, kind: "wordbook" });
    const groups = splitRecentDatasetOptions(filtered, ["gone", "b", "c", "c"]);
    expect(ids(groups.recent)).toEqual(["c"]);
    expect(ids(groups.remaining)).toEqual(["a"]);
  });
  it("최근 기록은 ID 6개 이내로 검증·중복 제거하고 선택을 앞으로 옮긴다", () => {
    expect(sanitizeRecentDatasetIds(null)).toEqual([]);
    expect(sanitizeRecentDatasetIds([null, "", 1, {}, "a b", "a", "a", "b"])).toEqual(["a", "b"]);
    expect(rememberDatasetSelection(["a", "b", "c", "d", "e", "f"], "g")).toEqual(["g", "a", "b", "c", "d", "e"]);
    expect(rememberDatasetSelection(["a", "b", "c"], "b")).toEqual(["b", "a", "c"]);
  });
});
