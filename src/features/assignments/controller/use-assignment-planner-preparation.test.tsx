// @vitest-environment jsdom
import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { announceStudentProfileUpdated } from "@/features/students/controller/student-directory-events";
import type { AssignmentPlannerPreparation } from "../contracts/assignment-workspace-read-model";
import { loadAssignmentPlannerPreparation } from "../transport/assignment-workspace-reads";
import { useAssignmentPlannerPreparation } from "./use-assignment-planner-preparation";

vi.mock("../transport/assignment-workspace-reads", () => ({ loadAssignmentPlannerPreparation: vi.fn() }));
vi.mock("./assignment-authentication-boundary", () => ({ useAssignmentAuthenticationFailure: () => () => vi.fn() }));
afterEach(() => { cleanup(); vi.resetAllMocks(); });

it("프로필 저장은 열린 준비 자료의 학생만 바꾸고 배정 자료와 선택 요청을 보존한다", async () => {
  const data: AssignmentPlannerPreparation = {
    datasets: [], initialUnits: [], initialDatasetId: "book", timeTemplates: [],
    students: [{ id: "fake-student", displayName: "가상 학생", schoolName: null, gradeLabel: null,
      status: "active", currentVocabBook: "기존 단어장", currentVocabDatasetId: "book" }],
  };
  vi.mocked(loadAssignmentPlannerPreparation).mockResolvedValue(data);
  const { result } = renderHook(useAssignmentPlannerPreparation);
  const request = { studentIds: ["fake-student"], selectionMode: "single" as const, initialDatasetId: "book", bulkFilterLabels: [] };
  await act(async () => result.current.actions.open(request));
  act(() => announceStudentProfileUpdated({ id: "other", displayName: "다른 학생", schoolName: "다른고", gradeLabel: "고1" }));
  expect(result.current.data).toBe(data);
  act(() => announceStudentProfileUpdated({ id: "fake-student", displayName: "보완 학생", schoolName: "가상고", gradeLabel: "고2" }));
  expect(result.current.status).toBe("ready");
  expect(result.current.request).toBe(request);
  expect(result.current.data?.students[0]).toMatchObject({ schoolName: "가상고", gradeLabel: "고2", currentVocabDatasetId: "book" });
  expect(result.current.data?.datasets).toBe(data.datasets);
  expect(result.current.data?.initialUnits).toBe(data.initialUnits);
  expect(loadAssignmentPlannerPreparation).toHaveBeenCalledOnce();
  act(() => result.current.actions.close());
  act(() => announceStudentProfileUpdated({ id: "fake-student", displayName: "보완 학생", schoolName: "가상고", gradeLabel: "고3" }));
  expect(result.current.status).toBe("idle");
  expect(result.current.data).toBeNull();
});
