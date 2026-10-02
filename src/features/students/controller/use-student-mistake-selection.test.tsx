// @vitest-environment jsdom
import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, expect, it } from "vitest";
import { fakeMistakeView } from "./mistake-test-fixtures";
import { useStudentMistakeSelection } from "./use-student-mistake-selection";
afterEach(cleanup);
it("뜻 선택 뒤 상태판·출처판·학생 변경에는 선택을 즉시 폐기한다", () => {
  const history = fakeMistakeView();
  const { result, rerender } = renderHook(useStudentMistakeSelection, { initialProps: { history, initialDatasetId: "", studentId: "a" } });
  act(() => result.current.actions.toggleVisible()); expect(result.current.selectedQueuedTargets).toHaveLength(1);
  rerender({ history: { ...history, sourceVersion: "b".repeat(64) }, initialDatasetId: "", studentId: "a" });
  expect(result.current.selectedQueuedTargets).toHaveLength(0);
  act(() => result.current.actions.toggleVisible());
  rerender({ history: { ...history, stateVersion: "2" }, initialDatasetId: "", studentId: "a" });
  expect(result.current.selectedQueuedTargets).toHaveLength(0);
  act(() => result.current.actions.toggleVisible());
  rerender({ history, initialDatasetId: "", studentId: "b" }); expect(result.current.selectedQueuedTargets).toHaveLength(0);
});
it("큐와 문제지 선택을 나누고 필터를 변경한 뒤에는 이전 선택을 되살리지 않는다", () => {
  const history = fakeMistakeView();
  const { result } = renderHook(() => useStudentMistakeSelection({ history, initialDatasetId: "", studentId: "a" }));
  act(() => result.current.actions.toggleVisible());
  act(() => result.current.actions.setPurpose("worksheet")); expect(result.current.selectedIds).toHaveLength(0);
  act(() => result.current.actions.toggleVisible()); expect(result.current.selectedWorksheetTargets).toHaveLength(1);
  act(() => result.current.actions.setQuery("다른 조건")); expect(result.current.selectedIds).toHaveLength(0);
  act(() => result.current.actions.setQuery("")); expect(result.current.selectedIds).toHaveLength(0);
});
