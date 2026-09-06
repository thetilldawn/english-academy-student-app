// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";

import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import type { ComponentType } from "react";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { cataloguedDatasetFromMetadata } from "@/lib/admin/dataset-catalog";
import type { StudentDirectorySnapshot } from "@/features/students/public-contracts";
import { assignmentQuestionModes } from "../domain/model";
import { AssignmentWorkspace } from "./assignment-workspace";
import { StudentDirectoryCacheProvider, announceStudentDirectoryRefresh } from "@/features/students/public-client";
import { announceAdminPrivateCacheChange } from "@/features/session/public-client";
import { CachedAssignmentWorkspace } from "./cached-assignment-workspace";
vi.mock("next/navigation", async importOriginal => ({ ...await importOriginal<typeof import("next/navigation")>(), usePathname: () => "/admin/assignments" }));

// Only the Next.js module loader and HTTP boundary are replaced. The student
// row, preparation controller, planner, range fields and picker are real.
vi.mock("next/dynamic", async () => {
  const { lazy, Suspense } = await import("react");
  return { default: (loader: () => Promise<ComponentType<Record<string, unknown>>>) => {
    const Loaded = lazy(async () => ({ default: await loader() }));
    return function DynamicComponent(props: Record<string, unknown>) {
      return <Suspense fallback={null}><Loaded {...props} /></Suspense>;
    };
  } };
});

const uid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const datasets = ["로컬 형용사", "로컬 공통영어"].map((title, index) => ({
  ...cataloguedDatasetFromMetadata({ id: uid(index + 10), title }, undefined),
  availableQuestionModes: assignmentQuestionModes,
  rowCount: 20, status: "ready" as const, isActive: true,
}));
const students = [1, 2].map((n) => ({
  id: uid(n), displayName: `가짜 학생 ${n}`, schoolName: "검사 학교", gradeLabel: "고1",
  currentVocabBook: null, currentVocabDatasetId: null, status: "active" as const,
}));
const directory: StudentDirectorySnapshot = {
  filterOptions: { classGroups: [], grades: ["고1"], schools: ["검사 학교"], wordbooks: [] },
  filters: { classGroupId: "", grade: "", query: "", school: "", status: "active", wordbook: "", wrong: "all" },
  page: { items: students.map((item) => ({
    ...item, codeStatus: "active", completedCount: 0, missedCount: 0, notStartedCount: 0,
    rawPoints: 0, recentExamAt: null,
  })), nextCursor: null },
  snapshotAt: "2026-09-05T00:00:00.000Z", totalCount: 2,
};
const fetchMock = vi.fn();

beforeAll(() => {
  Object.defineProperty(HTMLDialogElement.prototype, "showModal", {
    configurable: true, value() { this.setAttribute("open", ""); },
  });
  Object.defineProperty(HTMLDialogElement.prototype, "close", {
    configurable: true, value() { this.removeAttribute("open"); },
  });
  Object.defineProperty(HTMLElement.prototype, "scrollIntoView", { configurable: true, value: vi.fn() });
});
beforeEach(() => {
  window.localStorage.clear();
  fetchMock.mockReset();
  fetchMock.mockImplementation(async (input: string, init?: RequestInit) => {
    let payload: unknown;
    if (input === "/api/admin/students/directory") {
      const request = JSON.parse(String(init?.body));
      payload = request.identity ? { kind: "resume", identity: "a".repeat(64), userId: uid(999), points: directory.page.items.map(item => ({ id: item.id, rawPoints: item.rawPoints })) }
        : { kind: "snapshot", identity: "a".repeat(64), userId: uid(999), snapshot: { ...directory, filters: request.filters } };
    } else if (input === "/api/admin/assignment-workspace/preparation") {
      const request = JSON.parse(String(init?.body)) as { studentIds: string[] };
      payload = { preparation: { datasets, initialDatasetId: "", initialUnits: [], timeTemplates: [],
        students: students.filter((student) => request.studentIds.includes(student.id)),
      } };
    } else if (input === "/api/admin/assignment-workspace/previous-exam") {
      payload = { previousExam: null };
    } else if (input.startsWith("/api/admin/assignment-workspace/datasets/") && input.endsWith("/units")) {
      const datasetId = input.split("/").at(-2)!;
      payload = { datasetId, units: [{
        id: uid(100), datasetId, label: "DAY 01", displayName: "DAY 01", entryCount: 20,
        kind: "day", number: 1, sortIndex: 1, catalogSortIndex: 1, catalogGroup: "high", unitType: "day",
        academicYear: null, agency: null, examMonth: null, itemRange: null,
      }] };
    } else {
      throw new Error(`Unexpected local-only request: ${input}`);
    }
    return new Response(JSON.stringify(payload), { headers: { "content-type": "application/json" } });
  });
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

describe("실제 신규 배정 진입에서 단어장 검색까지", () => {
  const cached = () => <StudentDirectoryCacheProvider userId={uid(999)}><CachedAssignmentWorkspace initialDatasetId="" initialDialogView="overview" initialStudentId="" /></StudentDirectoryCacheProvider>;
  it.each([401, 403, 503])("현재 준비 요청 실패 %s는 인증 실패와 일반 오류를 구분한다", async status => {
    render(cached()); await screen.findByText("가짜 학생 1");
    fetchMock.mockResolvedValueOnce(Response.json({ error: "배정 준비 자료를 불러오지 못했습니다." }, { status }));
    fireEvent.click(screen.getAllByRole("button", { name: "단어 배정" })[0]!);
    if (status !== 503) {
      await screen.findByRole("link", { name: "관리자 로그인" });
      expect(screen.queryByText("가짜 학생 1")).not.toBeInTheDocument();
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    } else {
      await screen.findByText("배정 준비 자료를 불러오지 못했습니다.");
      expect(screen.getByText("가짜 학생 1")).toBeVisible();
      expect(screen.queryByRole("link", { name: "관리자 로그인" })).not.toBeInTheDocument();
    }
  });
  it("닫힌 준비 요청의 늦은 401은 현재 목록을 잠그지 않는다", async () => {
    render(cached()); await screen.findByText("가짜 학생 1");
    let finish!: (response: Response) => void;
    fetchMock.mockImplementationOnce(() => new Promise<Response>(resolve => { finish = resolve; }));
    fireEvent.click(screen.getAllByRole("button", { name: "단어 배정" })[0]!);
    await screen.findByRole("dialog"); fireEvent.click(screen.getByRole("button", { name: "닫기" }));
    await act(async () => finish(Response.json({ error: "만료" }, { status: 401 })));
    expect(screen.getByText("가짜 학생 1")).toBeVisible();
    expect(screen.queryByRole("link", { name: "관리자 로그인" })).not.toBeInTheDocument();
  });
  it("캐시 변경 한 건은 목록 한 번만 갱신하고 선택 바구니를 보존한다", async () => {
    render(cached()); await screen.findByText("가짜 학생 1");
    fireEvent.click(screen.getByRole("tab", { name: "일괄 배정" }));
    const choice = () => screen.getByRole("checkbox", { name: "가짜 학생 1 일괄 배정 선택" });
    fireEvent.click(choice()); expect(choice()).toBeChecked();
    const before = fetchMock.mock.calls.filter(([url]) => url === "/api/admin/students/directory").length;
    act(() => announceStudentDirectoryRefresh());
    await waitFor(() => expect(choice()).toBeChecked());
    expect(fetchMock.mock.calls.filter(([url]) => url === "/api/admin/students/directory")).toHaveLength(before + 1);
    act(() => announceAdminPrivateCacheChange("identity"));
    expect(screen.queryByText("가짜 학생 1")).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: "관리자 로그인" })).toBeVisible();
  });
  it("준비 요청 중 잠시 숨겨도 요청과 입력을 버리지 않고 확인 뒤 창을 복원한다", async () => {
    render(cached()); await screen.findByText("가짜 학생 1");
    const original = fetchMock.getMockImplementation()!;
    let finishPreparation!: (value: Response) => void;
    fetchMock.mockImplementation((url: string, init?: RequestInit) => url === "/api/admin/assignment-workspace/preparation"
      ? new Promise<Response>(resolve => { finishPreparation = resolve; }) : original(url, init));
    fireEvent.click(screen.getAllByRole("button", { name: "단어 배정" })[0]!);
    await waitFor(() => expect(finishPreparation).toBeTypeOf("function"));
    act(() => window.dispatchEvent(new Event("pagehide")));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    await act(async () => finishPreparation(Response.json({ preparation: { datasets, initialDatasetId: "", initialUnits: [], timeTemplates: [], students: [students[0]] } })));
    act(() => window.dispatchEvent(new Event("pageshow")));
    // The first real dynamic import also compiles in this test process.
    const dialog = await screen.findByRole("dialog", { name: /단일 배정/ }, { timeout: 5000 });
    expect(dialog).toBeVisible(); expect(fetchMock.mock.calls.filter(([url]) => url === "/api/admin/assignment-workspace/preparation")).toHaveLength(1);
    const name = screen.getByLabelText("새 시간 템플릿 이름");
    fireEvent.change(name, { target: { value: "보존할 시간 이름" } });
    act(() => window.dispatchEvent(new Event("pagehide"))); expect(dialog).not.toHaveAttribute("open");
    act(() => window.dispatchEvent(new Event("pageshow")));
    await waitFor(() => expect(dialog).toHaveAttribute("open"));
    expect(name).toHaveValue("보존할 시간 이름");
  });
  it("목록 실패를 실제 다시 불러오기 버튼으로 복구해도 적용 필터와 선택 바구니를 보존한다", async () => {
    const initialDirectory = { ...directory, filters: { ...directory.filters, query: "가짜" } };
    const refreshedDirectory = { ...initialDirectory, page: { ...initialDirectory.page,
      items: initialDirectory.page.items.map((student, index) => index === 1 ? { ...student, displayName: "갱신 확인 학생" } : student),
    } };
    let calls = 0;
    fetchMock.mockImplementation(async (url: string, init?: RequestInit) => {
      expect(url).toBe("/api/admin/students/directory");
      calls += 1;
      if (calls === 1) return Response.json({ error: "학생 목록을 불러오지 못했습니다." }, { status: 503 });
      expect(JSON.parse(String(init?.body)).filters.query).toBe("가짜");
      return Response.json({ snapshot: refreshedDirectory });
    });
    render(<AssignmentWorkspace initial={{ directory: initialDirectory }} />);
    fireEvent.click(screen.getByRole("tab", { name: "일괄 배정" }));
    const selection = () => screen.getByRole("checkbox", { name: "가짜 학생 1 일괄 배정 선택" });
    fireEvent.click(selection());
    const search = screen.getByRole("searchbox");
    fireEvent.change(search, { target: { value: "새 검색" } });
    await screen.findByRole("button", { name: "다시 불러오기" });
    expect(search).toHaveValue("가짜"); expect(selection()).toBeChecked();
    fireEvent.click(screen.getByRole("button", { name: "다시 불러오기" }));
    await screen.findByText("갱신 확인 학생");
    await waitFor(() => expect(screen.queryByRole("alert")).not.toBeInTheDocument());
    expect(calls).toBe(2); expect(search).toHaveValue("가짜"); expect(selection()).toBeChecked();
  });
  it("실제 조립 화면은 일정 숨김 시 이름을 보존하고 범위 탭 재진입 시 초기화한다", async () => {
    render(<AssignmentWorkspace initial={{ directory }} />);
    fireEvent.click(screen.getAllByRole("button", { name: "단어 배정" })[0]!);
    await screen.findByRole("button", { name: /단어장 찾기/ }, { timeout: 5000 });
    const name = screen.getByLabelText("새 시간 템플릿 이름");
    fireEvent.change(name, { target: { value: "보존할 시간 양식" } });
    const scheduleToggle = within(screen.getByText("시험일 사용").parentElement!)
      .getByRole("checkbox");
    fireEvent.click(scheduleToggle);
    expect(name.closest('[aria-hidden="true"]')).not.toBeNull();
    expect(name).toHaveValue("보존할 시간 양식");
    fireEvent.click(scheduleToggle);
    expect(name.closest('[aria-hidden="true"]')).toBeNull();
    expect(name).toHaveValue("보존할 시간 양식");
    fireEvent.click(screen.getByRole("tab", { name: "오답 시험" }));
    fireEvent.click(screen.getByRole("tab", { name: "단어 시험" }));
    expect(screen.getByLabelText("새 시간 템플릿 이름")).toHaveValue("");
    expect(fetchMock.mock.calls.some(([url]) => url === "/api/admin/vocab-time-templates")).toBe(false);
  });

  it.each(["single", "bulk", "student-link"] as const)("%s 진입은 같은 검색과 준비된 유형으로 연결한다", async (entry) => {
    render(<AssignmentWorkspace
      initial={{ directory }}
      initialStudentId={entry === "student-link" ? students[0]!.id : ""}
      initialDialogView={entry === "student-link" ? "assign" : "overview"}
    />);
    if (entry === "single") {
      fireEvent.click(screen.getAllByRole("button", { name: "단어 배정" })[0]!);
    } else if (entry === "bulk") {
      fireEvent.click(screen.getByRole("tab", { name: "일괄 배정" }));
      fireEvent.click(screen.getByRole("checkbox", { name: "가짜 학생 1 일괄 배정 선택" }));
      fireEvent.click(screen.getByRole("checkbox", { name: "가짜 학생 2 일괄 배정 선택" }));
      fireEvent.click(screen.getByRole("button", { name: "단어 배정" }));
    }
    // The real planner's first dynamic import includes Vite compilation. Allow
    // that test-only work under parallel build/test load, not an app delay.
    const trigger = await screen.findByRole("button", { name: /단어장 찾기/ }, { timeout: 5000 });
    const dialog = screen.getByRole("dialog");
    expect(within(dialog).getByText(/단어장을 먼저 선택하면/)).toBeVisible();
    expect(within(dialog).getByRole("tab", { name: "영영풀이 → 영어" })).toBeDisabled();
    fireEvent.click(trigger);
    const search = screen.getByRole("searchbox", { name: "단어장 검색" });
    fireEvent.change(search, { target: { value: "공통영어" } });
    expect(screen.getByText("검색 결과 1권")).toBeVisible();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole("button", { name: /로컬 공통영어.*선택/ }));
    expect(screen.queryByRole("searchbox", { name: "단어장 검색" })).not.toBeInTheDocument();
    await waitFor(() => expect(within(dialog).getByRole("button", { name: /단어장 찾기/ })).toHaveTextContent("로컬 공통영어"));
    for (const name of ["영영풀이 → 영어", "예문 → 영어"]) {
      const tab = within(dialog).getByRole("tab", { name });
      expect(tab).toBeEnabled();
      fireEvent.click(tab);
      expect(tab).toHaveAttribute("aria-selected", "true");
    }
    expect(within(dialog).queryByText(/검토 중|Preview/)).not.toBeInTheDocument();
    const scheduleToggle = within(within(dialog).getByText("시험일 사용").parentElement!).getByRole("checkbox");
    expect(scheduleToggle).not.toBeChecked();
    expect(scheduleToggle).toBeDisabled();
    expect(within(dialog).getByText(/영영풀이·예문 시험은 영어 단어 고르기로 출제하며/)).toBeVisible();
    for (const label of ["영어 → 뜻", "뜻 → 영어", "혼합"]) {
      expect(within(dialog).getByRole("button", { name: label })).toBeDisabled();
    }
    fireEvent.change(within(dialog).getByRole("spinbutton", { name: "통과 점수" }), { target: { value: "85" } });
    expect(within(dialog).getByRole("spinbutton", { name: "통과 점수" })).toHaveValue(85);
    const preparations = fetchMock.mock.calls.filter(([url]) => url.endsWith("/preparation"));
    expect(preparations).toHaveLength(1);
    const request = JSON.parse(preparations[0]![1].body);
    expect(request.studentIds).toEqual(entry === "bulk" ? students.map((student) => student.id) : [students[0]!.id]);
    expect(fetchMock.mock.calls.every(([url]) => url.startsWith("/api/admin/assignment-workspace/"))).toBe(true);
  });
});
