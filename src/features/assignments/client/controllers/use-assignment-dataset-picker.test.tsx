// @vitest-environment jsdom
import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cataloguedDatasetFromMetadata } from "@/lib/admin/dataset-catalog";
import { RECENT_DATASET_STORAGE_KEY, useAssignmentDatasetPicker } from "./use-assignment-dataset-picker";
import { assignmentStudentContext } from "../../domain/assignment-student-context";
import { EMPTY_DATASET_FILTERS } from "../../domain/assignment-dataset-picker";

const options = ["a", "b"].map((id) => ({ dataset: {
  ...cataloguedDatasetFromMetadata({ id, title: `단어장 ${id}` }, undefined),
  isActive: true, status: "ready" as const, rowCount: 100,
} }));
beforeEach(() => window.localStorage.clear());
afterEach(() => { cleanup(); vi.restoreAllMocks(); });

describe("배정 단어장 선택 수명", () => {
  it("학생 기본 조건과 수동 선택을 보존하고 대상 변경 때만 초기화한다", () => {
    const first = assignmentStudentContext([{ id: "one", schoolName: "가상고", gradeLabel: "고2" }]);
    const second = assignmentStudentContext([{ id: "two", schoolName: "다른고", gradeLabel: "고1" }]);
    const { result, rerender } = renderHook(({ context }) => useAssignmentDatasetPicker({ options, selectedId: "a", onSelect: vi.fn(), contextKey: context.key, initialFilters: context.filters }), { initialProps: { context: first } });
    expect(result.current.filters).toMatchObject({ school: "school:가상고", grade: "g11" });
    act(() => result.current.actions.changeGrade("g12"));
    act(() => result.current.actions.open());
    act(() => result.current.actions.close());
    act(() => result.current.actions.open());
    expect(result.current.filters.grade).toBe("g12");
    rerender({ context: second });
    expect(result.current.filters).toMatchObject({ school: "school:다른고", grade: "g10" });
    expect(result.current.buttons.school.some(option => option.label === "다른고")).toBe(true);
  });
  it("학생 정보 보완은 검색어와 수동 조건을 보존하며 자동 조건만 갱신한다", () => {
    const { result, rerender } = renderHook(({ initialFilters }) => useAssignmentDatasetPicker({
      options, selectedId: "a", onSelect: vi.fn(), contextKey: "student", initialFilters,
    }), { initialProps: { initialFilters: { ...EMPTY_DATASET_FILTERS } } });
    act(() => result.current.actions.changeQuery("주제"));
    act(() => result.current.actions.changeSemester("1"));
    rerender({ initialFilters: { ...EMPTY_DATASET_FILTERS, school: "school:가상고", grade: "g11", semester: "2" } });
    expect(result.current.filters).toMatchObject({ query: "주제", school: "school:가상고", grade: "g11", semester: "1" });
    act(() => result.current.actions.changeSchool("all"));
    rerender({ initialFilters: { ...EMPTY_DATASET_FILTERS, school: "school:전학고", grade: "g12", semester: "2" } });
    expect(result.current.filters).toMatchObject({ query: "주제", school: "all", grade: "g12", semester: "1" });
  });
  it("검색·필터·취소·동일 선택은 배정 전환을 호출하지 않는다", () => {
    const onSelect = vi.fn();
    const { result } = renderHook(() => useAssignmentDatasetPicker({ options, selectedId: "a", onSelect }));
    act(() => result.current.actions.open());
    act(() => result.current.actions.changeQuery("단어장"));
    act(() => result.current.actions.changeKind("unclassified"));
    act(() => result.current.actions.changeSemester("2"));
    act(() => result.current.actions.changeSchool("school:심석고등학교"));
    act(() => result.current.actions.close());
    expect(onSelect).not.toHaveBeenCalled();
    act(() => result.current.actions.open());
    expect(result.current.filters.query).toBe("단어장");
    expect(result.current.filters.semester).toBe("2");
    expect(result.current.filters.school).toBe("school:심석고등학교");
    act(() => result.current.actions.choose("a"));
    expect(onSelect).not.toHaveBeenCalled();
    act(() => result.current.actions.open());
    act(() => result.current.actions.choose("b"));
    expect(onSelect).toHaveBeenCalledExactlyOnceWith("b");
    expect(result.current.open).toBe(false);
  });
  it.each(["broken", '{"version":2,"ids":["a"]}', '{"version":1,"ids":{}}', "x".repeat(4097)])("손상되거나 다른 버전인 저장값을 무시한다", (raw) => {
    window.localStorage.setItem(RECENT_DATASET_STORAGE_KEY, raw);
    const { result } = renderHook(() => useAssignmentDatasetPicker({ options, selectedId: "a", onSelect: vi.fn() }));
    act(() => result.current.actions.open());
    expect(result.current.groups.recent).toEqual([]);
    expect(result.current.resultCount).toBe(2);
  });
  it("사용할 수 없는 최근 단어장은 표시·선택하지 않으며 최소 ID만 저장한다", () => {
    window.localStorage.setItem(RECENT_DATASET_STORAGE_KEY, JSON.stringify({ version: 1, ids: ["gone", "a"], studentName: "저장하지 않음" }));
    const onSelect = vi.fn();
    const { result } = renderHook(() => useAssignmentDatasetPicker({ options, selectedId: "a", onSelect }));
    act(() => result.current.actions.open());
    expect(result.current.groups.recent.map(({ dataset }) => dataset.id)).toEqual(["a"]);
    act(() => result.current.actions.choose("gone"));
    expect(onSelect).not.toHaveBeenCalled();
    expect(result.current.open).toBe(true);
    act(() => result.current.actions.choose("b"));
    expect(JSON.parse(window.localStorage.getItem(RECENT_DATASET_STORAGE_KEY)!)).toEqual({ version: 1, ids: ["b", "gone", "a"] });
  });
  it("저장소가 차단돼도 선택과 창 안 최근 기록은 정상 동작한다", () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => { throw new Error("blocked"); });
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => { throw new Error("quota"); });
    const onSelect = vi.fn();
    const { result } = renderHook(() => useAssignmentDatasetPicker({ options, selectedId: "a", onSelect }));
    act(() => result.current.actions.open());
    act(() => result.current.actions.choose("b"));
    expect(onSelect).toHaveBeenCalledExactlyOnceWith("b");
    act(() => result.current.actions.open());
    expect(result.current.groups.recent.map(({ dataset }) => dataset.id)).toEqual(["b"]);
  });
  it("저장 응답으로 추가된 단어장도 목록 갱신 전에 최근 선택을 보존한다", () => {
    const onSelect = vi.fn();
    const { result, rerender } = renderHook(({ list }) => useAssignmentDatasetPicker({ options: list, selectedId: "a", onSelect }), { initialProps: { list: [options[0]!] } });
    act(() => result.current.actions.open());
    act(() => result.current.actions.rememberSelection("b"));
    rerender({ list: options });
    expect(result.current.groups.recent.map(({ dataset }) => dataset.id)).toEqual(["b"]);
    expect(JSON.parse(window.localStorage.getItem(RECENT_DATASET_STORAGE_KEY)!)).toEqual({ version: 1, ids: ["b"] });
    expect(onSelect).not.toHaveBeenCalled();
  });
  it("학교급 변경 시 이전 학년 조건을 해제하고 후보 변경은 자동 반영한다", () => {
    const { result, rerender } = renderHook(({ list }) => useAssignmentDatasetPicker({ options: list, selectedId: "a", onSelect: vi.fn() }), { initialProps: { list: options } });
    act(() => result.current.actions.changeGrade("H1"));
    act(() => result.current.actions.changeStage("middle"));
    expect(result.current.filters.grade).toBe("all");
    act(() => result.current.actions.clear());
    rerender({ list: [options[0]!] });
    expect(result.current.resultCount).toBe(1);
  });
});
