// @vitest-environment jsdom
import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { announceStudentProfileUpdated } from "@/features/students/controller/student-directory-events";
import type { AssignmentPlannerPreparation } from "../contracts/assignment-workspace-read-model";
import { loadAssignmentPlannerPreparation } from "../transport/assignment-workspace-reads";
import { useAssignmentPlannerPreparation } from "./use-assignment-planner-preparation";

vi.mock("../transport/assignment-workspace-reads", () => ({ loadAssignmentPlannerPreparation: vi.fn() }));
vi.mock("./assignment-authentication-boundary", () => ({ useAssignmentAuthenticationFailure: () => () => vi.fn() }));
const session = vi.hoisted(() => ({ cache: { identity: "a".repeat(64), blocked: false } }));
vi.mock("@/features/students/public-client", async original => ({ ...await original<typeof import("@/features/students/public-client")>(), useStudentDirectoryCache: () => session }));
afterEach(() => { cleanup(); vi.resetAllMocks(); vi.useRealTimers(); session.cache.identity="a".repeat(64); });

it("준비 도중 자료가 바뀌면 늦은 응답을 성공 캐시에 남기지 않는다", async () => {
  const data: AssignmentPlannerPreparation = { datasets: [], initialUnits: [], initialDatasetId: "", timeTemplates: [], students: [] };
  let finish!: (value: AssignmentPlannerPreparation) => void;
  vi.mocked(loadAssignmentPlannerPreparation).mockImplementationOnce(() => new Promise(resolve => { finish = resolve; })).mockResolvedValue(data);
  const { result } = renderHook(() => useAssignmentPlannerPreparation());
  const request = { studentIds: ["fake"], selectionMode: "single" as const, initialDatasetId: "", bulkFilterLabels: [] };
  let pending!: Promise<void>;
  act(() => { pending = result.current.actions.open(request); });
  act(() => result.current.actions.invalidate());
  await act(async () => { finish(data); await pending; });
  expect(result.current.status).toBe("error");
  expect(result.current.data).toBeNull();
  act(() => result.current.actions.close());
  await act(() => result.current.actions.open(request));
  expect(loadAssignmentPlannerPreparation).toHaveBeenCalledTimes(2);
  expect(result.current.status).toBe("ready");
});

it("같은 인증과 대상은 15초만 재사용하고 재시도·자료변경·세대변경 때 새로 받는다",async()=>{
  vi.useFakeTimers();
  const data: AssignmentPlannerPreparation={datasets:[],initialUnits:[],initialDatasetId:"",timeTemplates:[],students:[]};
  vi.mocked(loadAssignmentPlannerPreparation).mockResolvedValue(data);
  const {result}=renderHook(()=>useAssignmentPlannerPreparation());
  const request={studentIds:["fake"],selectionMode:"single" as const,initialDatasetId:"",bulkFilterLabels:[]};
  await act(()=>result.current.actions.open(request));
  act(()=>result.current.actions.close());
  await act(()=>result.current.actions.open(request));
  expect(loadAssignmentPlannerPreparation).toHaveBeenCalledOnce();
  await act(()=>result.current.actions.retry());
  expect(loadAssignmentPlannerPreparation).toHaveBeenCalledTimes(2);
  act(()=>result.current.actions.invalidate());
  await act(()=>result.current.actions.open(request));
  session.cache.identity="b".repeat(64);
  await act(()=>result.current.actions.open(request));
  await vi.advanceTimersByTimeAsync(15000);
  await act(()=>result.current.actions.open(request));
  expect(loadAssignmentPlannerPreparation).toHaveBeenCalledTimes(5);
});

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
