// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";

import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import type { ComponentType } from "react";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { cataloguedDatasetFromMetadata } from "@/lib/admin/dataset-catalog";
import type { StudentDirectorySnapshot } from "@/features/students/public-contracts";
import { assignmentQuestionModes } from "../domain/model";
import { bulkAssignmentPreviewSchema, type BulkAssignmentPreviewInput } from "../contracts/bulk-assignment-request";
import { resolveVocabQuestionCycleAllocation } from "../domain/vocab-question-allocation";
import { resolveUndatedVocabUnitCycleAllocation } from "../domain/vocab-unit-allocation";
import { AssignmentWorkspace } from "./assignment-workspace";
import { StudentDirectoryCacheProvider, announceStudentDirectoryRefresh } from "@/features/students/public-client";
import { announceAdminPrivateCacheChange } from "@/features/session/public-client";
import { CachedAssignmentWorkspace } from "./cached-assignment-workspace";
vi.mock("next/navigation", async importOriginal => ({ ...await importOriginal<typeof import("next/navigation")>(), usePathname: () => "/admin/assignments", useSelectedLayoutSegments: () => ["assignments"] }));

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
afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.useRealTimers(); });

describe("실제 신규 배정 진입에서 단어장 검색까지", () => {
  it.each(["single", "bulk"] as const)("%s에서 날짜를 고르기 전부터 회차별·단어 수 가능 회차를 표시한다", async mode => {
    const original = fetchMock.getMockImplementation()!;
    const previewRequests: BulkAssignmentPreviewInput[] = [];
    fetchMock.mockImplementation(async (url: string, init?: RequestInit) => {
      if (url.includes("/datasets/") && url.endsWith("/units")) {
        return Response.json({ datasetId: datasets[0]!.id, units: Array.from({ length: 6 }, (_, index) => ({
          id: uid(100 + index), datasetId: datasets[0]!.id, label: `DAY ${index + 1}`, displayName: `DAY ${index + 1}`,
          entryCount: index === 5 ? 101 : 100, kind: "day", number: index + 1, sortIndex: index + 1,
          catalogSortIndex: index + 1, catalogGroup: "high", unitType: "day",
          academicYear: null, agency: null, examMonth: null, itemRange: null,
        })) });
      }
      if (url !== "/api/admin/bulk-assignments/preview") return original(url, init);
      // Validate the real HTTP contract, not just the component's invented shape.
      const body = bulkAssignmentPreviewSchema.parse(JSON.parse(String(init?.body)));
      previewRequests.push(body);
      const plan = body.commonPlan;
      const defaultSessionCount = plan.splitBasis === "range_unit"
        ? resolveUndatedVocabUnitCycleAllocation({ orderedUnitIds: plan.orderedUnitIds, unitsPerSession: plan.unitAllocationRule!.unitsPerSession }).defaultSessionCount
        : resolveVocabQuestionCycleAllocation({ ...plan, availableQuestionCount: 601, maximumSessionQuestionCount: 500 }).defaultSessionCount;
      return Response.json({
        assignableCount: 0, blockedCount: body.studentIds.length, assignmentCount: 0,
        commonPlanSummary: null, planSignature: "a".repeat(64), rangeLabel: "DAY 1~DAY 6",
        items: body.studentIds.map(studentId => ({
          studentId, studentName: "가짜 학생", datasetId: plan.datasetId, datasetLabel: "가짜 자료",
          available: false, sessions: [], availableQuestionCount: 601, totalAvailableQuestionCount: 601,
          maximumSessionQuestionCount: 500, defaultSessionCount,
          error: null, remainingQuestionCount: 601, selectedQuestionCount: 0, scheduledQuestionCount: 0, requiresExtraDateDecision: false,
        })),
      });
    });
    render(<AssignmentWorkspace initial={{ directory }} />);
    if (mode === "bulk") {
      fireEvent.click(screen.getByRole("tab", { name: "일괄 배정" }));
      for (const student of students) fireEvent.click(screen.getByRole("checkbox", { name: `${student.displayName} 일괄 배정 선택` }));
    }
    fireEvent.click(screen.getAllByRole("button", { name: "단어 배정" })[0]!);
    fireEvent.click(await screen.findByRole("button", { name: /단어장 찾기/ }, { timeout: 5000 }));
    fireEvent.click(screen.getByRole("button", { name: /로컬 형용사.*선택/ }));
    const dialog = screen.getByRole("dialog");
    await within(dialog).findByRole("button", { name: "DAY 6" });
    // Toggle all through the public control; do not manipulate hook state.
    const all = within(dialog).getByRole("button", { name: "전체 선택" });
    fireEvent.click(all);
    fireEvent.click(within(dialog).getByRole("button", { name: "회차별" }));
    fireEvent.change(await within(dialog).findByRole("textbox", { name: /^회차당 단위 수/ }), { target: { value: "2" } });
    expect(await within(dialog).findByText("날짜 없이 3회 배정")).toBeVisible();
    fireEvent.click(within(dialog).getByRole("button", { name: "단어 수" }));
    fireEvent.change(await within(dialog).findByRole("textbox", { name: "회차당 단어 수" }), { target: { value: "100" } });
    expect(await within(dialog).findByText("날짜 없이 7회 배정")).toBeVisible();
    expect(within(dialog).getByText(/한 번씩 나눌 때 출제 가능 601개 · 회차당 최대 500개/)).toBeVisible();
    fireEvent.click(within(dialog).getByRole("button", { name: "배정하기" }));
    expect(within(dialog).queryByText("배정할 요일을 하나 이상 선택해 주세요.")).not.toBeInTheDocument();
    expect(previewRequests.length).toBeGreaterThan(0);
    expect(previewRequests.every(body => body.commonPlan.selectedDateCount === 0
      && body.commonPlan.sessions.every(session => session.availableFrom === null && session.availableUntil === null))).toBe(true);
    expect(fetchMock.mock.calls.some(([url]) => url === "/api/admin/bulk-assignments")).toBe(false);
  });
  it.each(["single", "bulk"] as const)("%s의 실제 수량 대기·실패·재시도·범위변경은 수록 수와 작성값을 보존한다", async mode => {
    const original = fetchMock.getMockImplementation()!;
    const pending: Array<{ finish: (response: Response) => void; studentIds: string[] }> = [];
    const success = (studentIds: string[], questionCount: number) => Response.json({
      assignableCount: studentIds.length, assignmentCount: studentIds.length, blockedCount: 0,
      commonPlanSummary: null, planSignature: "a".repeat(64), rangeLabel: "DAY 01",
      items: studentIds.map(studentId => ({
        available: true, availableQuestionCount: 16, datasetId: datasets[0]!.id, datasetLabel: "로컬 형용사",
        defaultSessionCount: 1, error: null, remainingQuestionCount: 16 - questionCount, requiresExtraDateDecision: false,
        scheduledQuestionCount: questionCount, selectedQuestionCount: questionCount, studentId, studentName: "가짜 학생",
        sessions: [{ available: true, availableFrom: null, availableUntil: null, cycleIndex: 0,
          error: null, questionCount, rangeTruncated: false, sessionNumber: 1, sourceSessionNumber: 1,
          unitId: uid(100), unitIds: [uid(100)], unitLabel: "DAY 01", unitLabels: ["DAY 01"] }],
      })),
    });
    fetchMock.mockImplementation((url: string, init?: RequestInit) => {
      if (url !== "/api/admin/bulk-assignments/preview") return original(url, init);
      return new Promise<Response>(finish => pending.push({ finish, studentIds: JSON.parse(String(init?.body)).studentIds }));
    });
    render(<AssignmentWorkspace initial={{ directory }} />);
    if (mode === "bulk") {
      fireEvent.click(screen.getByRole("tab", { name: "일괄 배정" }));
      for (const student of students) fireEvent.click(screen.getByRole("checkbox", { name: `${student.displayName} 일괄 배정 선택` }));
    }
    fireEvent.click(screen.getAllByRole("button", { name: "단어 배정" })[0]!);
    const trigger = await screen.findByRole("button", { name: /단어장 찾기/ }, { timeout: 5000 });
    const dialog = screen.getByRole("dialog");
    const schedule = within(within(dialog).getByText("시험일 사용").parentElement!).getByRole("checkbox");
    if ((schedule as HTMLInputElement).checked) fireEvent.click(schedule);
    fireEvent.click(trigger);
    fireEvent.click(screen.getByRole("button", { name: /로컬 형용사.*선택/ }));
    const unit = await within(dialog).findByRole("button", { name: "DAY 01" });
    if (unit.getAttribute("aria-pressed") !== "true") fireEvent.click(unit);
    fireEvent.click(within(dialog).getByRole("button", { name: "단어 수" }));
    await waitFor(() => expect(pending.length).toBeGreaterThan(0));
    const input = within(dialog).getByRole("textbox", { name: "회차당 단어 수" });
    expect(within(dialog).getByText("선택한 범위 1개 · 수록 단어 20개")).toBeVisible();
    expect(within(dialog).getByText("출제 가능 단어 수를 확인하는 중입니다.")).toBeVisible();
    fireEvent.focus(input);
    expect(input).not.toHaveValue("0");
    expect(within(dialog).getByRole("button", { name: "전체 사용" })).toHaveAttribute("aria-pressed", "true");
    await act(async () => pending.at(-1)!.finish(Response.json({ error: "private raw SQL error" }, { status: 503 })));
    const retry = await within(dialog).findByRole("button", { name: "단어 수 다시 확인" });
    expect(within(dialog).queryByText(/private raw SQL/)).not.toBeInTheDocument();
    expect(within(dialog).getByText("선택한 범위 1개 · 수록 단어 20개")).toBeVisible();
    const previousCalls = pending.length;
    fireEvent.click(retry);
    await waitFor(() => expect(pending.length).toBeGreaterThan(previousCalls));
    expect(within(dialog).queryByRole("button", { name: "단어 수 다시 확인" })).not.toBeInTheDocument();
    const retried = pending.at(-1)!;
    await act(async () => retried.finish(success(retried.studentIds, 16)));
    if (mode === "single") {
      expect(within(dialog).getByRole("button", { name: "전체 사용 · 16개" })).toBeVisible();
      expect(within(dialog).getByText(/출제 가능 16개/)).toBeVisible();
      expect(input).toHaveValue("16");
    } else {
      expect(within(dialog).getByText(/전체 가능 단어 수는 다시 확인해 주세요/)).toBeVisible();
      expect(within(dialog).queryByRole("button", { name: "전체 사용 · 16개" })).not.toBeInTheDocument();
    }
    expect(within(dialog).getByText("선택한 범위 1개 · 수록 단어 20개")).toBeVisible();
    fireEvent.change(input, { target: { value: "8" } });
    await waitFor(() => expect(pending.length).toBeGreaterThan(previousCalls + 1));
    expect(input).toHaveValue("8");
    const old = pending.at(-1)!;
    fireEvent.click(unit);
    await act(async () => old.finish(success(old.studentIds, 8)));
    expect(within(dialog).queryByText(/출제 가능 16개/)).not.toBeInTheDocument();
    expect(input).toHaveValue("8");
    expect(unit).toHaveAttribute("aria-pressed", "false");
    expect(fetchMock.mock.calls.some(([url]) => url === "/api/admin/bulk-assignments")).toBe(false);
  });
  const cached = (owner = uid(999)) => <StudentDirectoryCacheProvider userId={owner}><CachedAssignmentWorkspace initialDatasetId="" initialDialogView="overview" initialStudentId="" /></StudentDirectoryCacheProvider>;
  async function openTimedDraft(mode: "single" | "bulk" = "single") {
    // Preload the real planner before the fake clock; this is test compilation,
    // not an application delay or a replacement for its UI/controller.
    await import("./vocab-assignment-planner");
    vi.useFakeTimers();
    const { rerender } = render(cached());
    await act(async () => { await Promise.resolve(); });
    if (mode === "bulk") {
      fireEvent.click(screen.getByRole("tab", { name: "일괄 배정" }));
      for (const student of students) fireEvent.click(screen.getByRole("checkbox", { name: `${student.displayName} 일괄 배정 선택` }));
    }
    fireEvent.click(screen.getAllByRole("button", { name: "단어 배정" })[0]!);
    await act(async () => { await vi.advanceTimersByTimeAsync(0); });
    const dialog = screen.getByRole("dialog", { name: mode === "bulk" ? /일괄 배정/ : /단일 배정/ });
    const name = within(dialog).getByLabelText("새 시간 템플릿 이름");
    fireEvent.change(name, { target: { value: "오래 작성하는 배정" } });
    const score = within(dialog).getByRole("textbox", { name: "통과 점수" });
    fireEvent.change(score, { target: { value: "85" } });
    score.focus();
    return { dialog, name, score, rerender };
  }
  it.each(["single", "bulk"] as const)("%s 배정은 60초와 120초 뒤에도 작성창·값·초점·선택을 유지한다", async mode => {
    const { dialog, name, score } = await openTimedDraft(mode);
    const requestCount = fetchMock.mock.calls.length;
    for (const elapsed of [60000, 60001]) {
      await act(async () => { await vi.advanceTimersByTimeAsync(elapsed); });
      expect(dialog).toHaveAttribute("open"); expect(dialog).toBeVisible();
      expect(name).toHaveValue("오래 작성하는 배정"); expect(score).toHaveValue("85"); expect(score).toHaveFocus();
      expect(fetchMock).toHaveBeenCalledTimes(requestCount);
      expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    }
    fireEvent.click(within(dialog).getByRole("button", { name: "닫기" }));
    if (mode === "bulk") for (const student of students) expect(screen.getByRole("checkbox", { name: `${student.displayName} 일괄 배정 선택` })).toBeChecked();
  });
  it("같은 화면의 목록 갱신 대기·503·성공은 배정 입력을 지우지 않고 실제 오류를 표시한다", async () => {
    const { dialog, name, score } = await openTimedDraft();
    await act(async () => { await vi.advanceTimersByTimeAsync(60000); });
    let finish!: (value: Response) => void;
    fetchMock.mockImplementationOnce(() => new Promise<Response>(resolve => { finish = resolve; }));
    // Exercise the outer reload callback while the real dialog remains mounted.
    // Native modal outside-click behavior is verified separately in the browser.
    fireEvent.click(screen.getByRole("button", { name: "다시 불러오기" }));
    expect(dialog).toHaveAttribute("open"); expect(name).toHaveValue("오래 작성하는 배정");
    expect(screen.getByRole("button", { name: "다시 불러오기" })).toBeDisabled();
    await act(async () => finish(Response.json({ error: "private internal failure" }, { status: 503 })));
    expect(screen.getByRole("alert")).toHaveTextContent("학생 목록을 불러오지 못했습니다. 다시 불러와 주세요.");
    expect(screen.queryByText("최신 학생 목록을 다시 확인해 주세요.")).not.toBeInTheDocument();
    expect(screen.queryByText(/private internal failure/)).not.toBeInTheDocument();
    expect(dialog).toHaveAttribute("open"); expect(score).toHaveValue("85"); expect(score).toHaveFocus();
    fireEvent.click(screen.getByRole("button", { name: "다시 불러오기" }));
    await act(async () => { await vi.advanceTimersByTimeAsync(0); });
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(dialog).toHaveAttribute("open"); expect(name).toHaveValue("오래 작성하는 배정");
  });
  it("복귀 요청이 실패하면 이전 성공 자료를 새 인증처럼 표시하지 않고 성공 뒤에만 초안을 복원한다", async () => {
    const { dialog, name } = await openTimedDraft();
    let finish!: (value: Response) => void;
    fetchMock.mockImplementationOnce(() => new Promise<Response>(resolve => { finish = resolve; }));
    act(() => window.dispatchEvent(new Event("pagehide")));
    act(() => window.dispatchEvent(new Event("pageshow")));
    expect(dialog).not.toHaveAttribute("open"); expect(name).not.toBeVisible();
    await act(async () => finish(Response.json({}, { status: 503 })));
    await act(async () => { await vi.advanceTimersByTimeAsync(0); });
    expect(dialog).not.toHaveAttribute("open"); expect(name).not.toBeVisible();
    expect(screen.queryByRole("checkbox", { name: /가짜 학생/ })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "다시 불러오기" }));
    await act(async () => { await vi.advanceTimersByTimeAsync(0); });
    expect(dialog).toHaveAttribute("open"); expect(name).toHaveValue("오래 작성하는 배정");
  });
  it.each([401, 403])("만료 뒤 현재 목록 갱신이 %s이면 보존 중인 배정도 제거한다", async status => {
    const { dialog } = await openTimedDraft();
    await act(async () => { await vi.advanceTimersByTimeAsync(60000); });
    fetchMock.mockResolvedValueOnce(Response.json({}, { status }));
    fireEvent.click(screen.getByRole("button", { name: "다시 불러오기" }));
    await act(async () => { await vi.advanceTimersByTimeAsync(0); });
    expect(dialog).not.toBeInTheDocument();
    expect(screen.queryByText("가짜 학생 1")).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: "관리자 로그인" })).toBeVisible();
  });
  it.each(["logout", "account"] as const)("오래 열린 작성창도 %s 변경 뒤에는 노출하지 않는다", async change => {
    const { dialog, name, rerender } = await openTimedDraft();
    await act(async () => { await vi.advanceTimersByTimeAsync(120001); });
    if (change === "logout") act(() => announceAdminPrivateCacheChange("identity"));
    else {
      fetchMock.mockImplementationOnce(() => new Promise<Response>(() => {}));
      rerender(cached(uid(888)));
    }
    expect(dialog).not.toBeInTheDocument(); expect(name).not.toBeInTheDocument();
    expect(screen.queryByText("가짜 학생 1")).not.toBeInTheDocument();
  });
  it.each([200, 401])("이전 복귀 요청의 늦은 %s는 현재 작성창과 최신 목록에 영향을 주지 않는다", async status => {
    const { dialog, name } = await openTimedDraft();
    let finishOld!: (value: Response) => void;
    fetchMock.mockImplementationOnce(() => new Promise<Response>(resolve => { finishOld = resolve; }));
    act(() => window.dispatchEvent(new Event("pagehide")));
    act(() => window.dispatchEvent(new Event("pageshow")));
    act(() => window.dispatchEvent(new Event("pagehide")));
    act(() => window.dispatchEvent(new Event("pageshow")));
    await act(async () => { await vi.advanceTimersByTimeAsync(0); });
    expect(dialog).toHaveAttribute("open");
    await act(async () => finishOld(Response.json(status === 401 ? {} : {
      kind: "snapshot", userId: uid(999), identity: "b".repeat(64), snapshot: {
        ...directory, page: { ...directory.page, items: [{ ...directory.page.items[0], displayName: "뒤늦게 들어온 학생" }] },
      },
    }, { status })));
    expect(dialog).toHaveAttribute("open"); expect(name).toHaveValue("오래 작성하는 배정");
    expect(screen.queryByText("뒤늦게 들어온 학생")).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "관리자 로그인" })).not.toBeInTheDocument();
  });
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
    expect(scheduleToggle).toBeChecked();
    expect(scheduleToggle).toBeEnabled();
    expect(within(dialog).getByText(/예문 시험도 회차별 또는 단어 수별로/)).toBeVisible();
    for (const label of ["영어 → 뜻", "뜻 → 영어", "혼합"]) {
      expect(within(dialog).getByRole("button", { name: label })).toBeDisabled();
    }
    fireEvent.change(within(dialog).getByRole("textbox", { name: "통과 점수" }), { target: { value: "85" } });
    expect(within(dialog).getByRole("textbox", { name: "통과 점수" })).toHaveValue("85");
    const preparations = fetchMock.mock.calls.filter(([url]) => url.endsWith("/preparation"));
    expect(preparations).toHaveLength(1);
    const request = JSON.parse(preparations[0]![1].body);
    expect(request.studentIds).toEqual(entry === "bulk" ? students.map((student) => student.id) : [students[0]!.id]);
    expect(fetchMock.mock.calls.every(([url]) => url.startsWith("/api/admin/assignment-workspace/"))).toBe(true);
  });
});
