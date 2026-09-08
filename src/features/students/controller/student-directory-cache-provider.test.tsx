/** @vitest-environment jsdom */
import "@testing-library/jest-dom/vitest";
import { StrictMode } from "react";
import { renderToString } from "react-dom/server";
import { hydrateRoot } from "react-dom/client";
import type { DirectoryCacheResponse } from "../contracts/student-directory-cache-contract";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ pathname: "/admin/students", background: "", read: vi.fn() }));
vi.mock("next/navigation", () => ({ usePathname: () => mocks.pathname, useSelectedLayoutSegments: () => (mocks.background || mocks.pathname).split("/").slice(2) }));
vi.mock("../transport/student-directory-cache-read", () => ({ readStudentDirectoryCache: mocks.read }));
import { StudentDirectoryCacheProvider } from "./student-directory-cache-provider";
import { CachedStudentDirectory } from "../ui/cached-student-directory";
import { announceAdminPrivateCacheChange, subscribeAdminPrivateCacheChanges } from "@/features/session/public-client";
import { announceStudentDirectoryRefresh } from "./student-directory-events";
import { emptyStudentDirectoryFilters as filters } from "../contracts/student-directory-read-model";
import { StudentDirectoryRequestError } from "../contracts/student-directory-cache-contract";
const userId = "00000000-0000-4000-8000-000000000999", id = "00000000-0000-4000-8000-000000000001", identity = "a".repeat(64);
function response() { return { kind: "snapshot", identity, userId, snapshot: { filters, filterOptions: { classGroups: [], grades: [], schools: [], wordbooks: [] }, snapshotAt: "2026-09-06T00:00:00Z", totalCount: 1, page: { nextCursor: null, items: [{ id, displayName: "가짜 학생", schoolName: null, gradeLabel: null, status: "active", codeStatus: "active", currentVocabBook: null, recentExamAt: null, rawPoints: 30, completedCount: 0, missedCount: 0, notStartedCount: 0 }] } } }; }
function view(owner = userId, initialResponse?: Extract<DirectoryCacheResponse, { kind: "snapshot" }>) { return <StrictMode><StudentDirectoryCacheProvider userId={owner}>{mocks.pathname === "/admin/students" ? <CachedStudentDirectory initialResponse={initialResponse} /> : <p>다른 화면</p>}</StudentDirectoryCacheProvider></StrictMode>; }
beforeEach(() => { mocks.pathname = "/admin/students"; mocks.background = ""; mocks.read.mockReset().mockImplementation(async () => response()); });
afterEach(() => { cleanup(); vi.useRealTimers(); });
describe("실제 학생 목록과 개인 캐시 연결", () => {
  it("가로채기 상세 왕복은 배경 목록 DOM과 작성 중 검색을 보존하고 재조회하지 않는다", async () => {
    mocks.background = "/admin/students";
    const persistent = () => <StudentDirectoryCacheProvider userId={userId}><CachedStudentDirectory /></StudentDirectoryCacheProvider>;
    const { rerender } = render(persistent());
    const row = await screen.findByText("가짜 학생");
    const search = screen.getByRole("searchbox", { name: "학생 및 학습 자료 검색" });
    fireEvent.change(search, { target: { value: "작성 중" } });
    const count = mocks.read.mock.calls.length;
    mocks.pathname = "/admin/students/" + id; rerender(persistent());
    expect(screen.getByText("가짜 학생")).toBe(row);
    expect(screen.getByRole("searchbox", { name: "학생 및 학습 자료 검색" })).toBe(search);
    expect(search).toHaveValue("작성 중");
    mocks.pathname = "/admin/students"; rerender(persistent());
    expect(screen.getByText("가짜 학생")).toBe(row);
    expect(mocks.read).toHaveBeenCalledTimes(count);
  });

  it("신선도 만료 뒤 갱신 대기는 목록 DOM을 유지하고 옛 오류 대신 로딩을 표시한다", async () => {
    vi.useFakeTimers(); render(view()); await act(async () => { await Promise.resolve(); });
    const row = screen.getByText("가짜 학생");
    await act(async () => { await vi.advanceTimersByTimeAsync(60000); });
    mocks.read.mockImplementation(() => new Promise(() => {}));
    fireEvent.click(screen.getByRole("button", { name: "다시 불러오기" }));
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(screen.queryByText("최신 학생 목록을 다시 확인해 주세요.")).not.toBeInTheDocument();
    expect(screen.getByText("가짜 학생")).toBe(row);
    expect(screen.getByText("학생 목록을 새로 불러오는 중입니다.")).toBeVisible();
    expect(screen.getByRole("button", { name: "다시 불러오기" })).toBeDisabled();
  });
  it("첫 HTML hydration은 서버 응답을 인계해 중복 요청하지 않고 복귀 때는 재검증한다", async () => {
    const seed = response() as Extract<DirectoryCacheResponse, { kind: "snapshot" }>;
    const host = document.createElement("div"); host.innerHTML = renderToString(view(userId, seed)); document.body.appendChild(host);
    let root!: ReturnType<typeof hydrateRoot>;
    try {
      await act(async () => { root = hydrateRoot(host, view(userId, seed)); });
      expect(screen.getByText("가짜 학생")).toBeVisible(); expect(mocks.read).not.toHaveBeenCalled();
      mocks.read.mockResolvedValue({ kind: "resume", identity, userId, points: [{ id, rawPoints: 48 }] });
      act(() => window.dispatchEvent(new Event("pagehide"))); act(() => window.dispatchEvent(new Event("pageshow")));
      await screen.findByText("현재 포인트 48"); expect(mocks.read.mock.calls.at(-1)?.[0]).toMatchObject({ identity, studentIds: [id] });
    } finally { await act(async () => root?.unmount()); host.remove(); }
  });
  it("Client 경로에 옛 서버 응답이 다시 와도 인증 전에 표시하지 않는다", async () => {
    mocks.read.mockImplementation(() => new Promise(() => {}));
    render(view(userId, response() as Extract<DirectoryCacheResponse, { kind: "snapshot" }>));
    expect(screen.queryByText("가짜 학생")).not.toBeInTheDocument(); expect(mocks.read).toHaveBeenCalled();
  });
  it("StrictMode에서 첫 목록을 읽고 왕복은 인증/새 포인트 전까지 숨긴다", async () => {
    const { rerender } = render(view()); await screen.findByText("가짜 학생");
    mocks.pathname = "/admin/assignments"; rerender(view());
    let finish!: (value: unknown) => void; mocks.read.mockImplementation(() => new Promise(resolve => { finish = resolve; }));
    mocks.pathname = "/admin/students"; rerender(view());
    expect(screen.queryByText("가짜 학생")).not.toBeInTheDocument();
    await act(async () => finish({ kind: "resume", identity, userId, points: [{ id, rawPoints: 44 }] }));
    expect(screen.getByText("가짜 학생")).toBeVisible(); expect(screen.getByText("현재 포인트 44")).toBeVisible();
    expect(mocks.read.mock.calls.at(-1)?.[0]).toMatchObject({ identity, studentIds: [id] });
  });
  it("계정 교체는 이전 행을 즉시 숨기며 이전 계정 응답을 재사용하지 않는다", async () => {
    const { rerender } = render(view()); await screen.findByText("가짜 학생");
    mocks.read.mockImplementation(() => new Promise(() => {})); rerender(view("00000000-0000-4000-8000-000000000888"));
    expect(screen.queryByText("가짜 학생")).not.toBeInTheDocument(); expect(mocks.read.mock.calls.at(-1)?.[0].identity).toBeUndefined();
  });
  it("로그아웃 신호 후 실패하거나 재진입해도 개인 목록은 복원하지 않는다", async () => {
    const { rerender } = render(view()); await screen.findByText("가짜 학생");
    act(() => announceAdminPrivateCacheChange("identity")); expect(screen.queryByText("가짜 학생")).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: "관리자 로그인" })).toBeVisible(); const count = mocks.read.mock.calls.length;
    mocks.pathname = "/admin/assignments"; rerender(view()); mocks.pathname = "/admin/students"; rerender(view());
    expect(mocks.read).toHaveBeenCalledTimes(count);
  });
  it("학생 변경 후 캐시 대신 첫 목록을 다시 읽는다", async () => {
    render(view()); await screen.findByText("가짜 학생");
    const count = mocks.read.mock.calls.length; act(() => announceStudentDirectoryRefresh());
    await waitFor(() => expect(mocks.read.mock.calls.length).toBeGreaterThan(count));
    expect(mocks.read.mock.calls.at(-1)?.[0].identity).toBeUndefined();
  });
  it("탭 숨김과 복귀 시 현재 인증을 확인한다", async () => {
    render(view()); await screen.findByText("가짜 학생");
    act(() => window.dispatchEvent(new Event("pagehide"))); expect(screen.queryByText("가짜 학생")).not.toBeInTheDocument();
    act(() => window.dispatchEvent(new Event("pageshow"))); await screen.findByText("가짜 학생");
  });
  it("조회 실패를 빈 결과로 바꾸지 않고 명시 재시도로 복구한다", async () => {
    mocks.read.mockRejectedValue(new StudentDirectoryRequestError(503)); render(view());
    await screen.findByRole("alert"); expect(screen.queryByText("조건에 맞는 학생이 없습니다.")).not.toBeInTheDocument();
    mocks.read.mockResolvedValue(response()); fireEvent.click(screen.getByRole("button", { name: "다시 불러오기" })); await screen.findByText("가짜 학생");
  });
  it("60초는 목록 신선도 안내이며 같은 화면의 목록 DOM을 지우거나 주기 조회하지 않는다", async () => {
    vi.useFakeTimers(); render(view()); await act(async () => { await Promise.resolve(); });
    const row = screen.getByText("가짜 학생"); const count = mocks.read.mock.calls.length;
    await act(async () => { await vi.advanceTimersByTimeAsync(60000); });
    expect(screen.getByText("가짜 학생")).toBe(row); expect(mocks.read).toHaveBeenCalledTimes(count);
    expect(screen.getByText("이전에 불러온 학생 목록입니다. 최신 내용은 다시 불러와 확인할 수 있습니다.")).toBeVisible();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "다시 불러오기" })).toBeVisible();
  });
  it("최초 읽기 중 무효화도 옛 요청을 버리고 자동으로 새 목록을 읽는다", async () => {
    mocks.read.mockImplementation(() => new Promise(() => {})); render(view());
    mocks.read.mockResolvedValue(response()); act(() => announceStudentDirectoryRefresh());
    await screen.findByText("가짜 학생"); expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });
  it("만료 후 재조회 실패는 단순 만료 안내로 덮지 않는다", async () => {
    vi.useFakeTimers(); render(view()); await act(async () => { await Promise.resolve(); });
    await act(async () => { await vi.advanceTimersByTimeAsync(60000); });
    mocks.read.mockRejectedValue(new StudentDirectoryRequestError(503));
    fireEvent.click(screen.getByRole("button", { name: "다시 불러오기" }));
    await act(async () => { await vi.advanceTimersByTimeAsync(0); });
    expect(screen.getByRole("alert")).toHaveTextContent("학생 목록을 불러오지 못했습니다. 다시 불러와 주세요.");
    expect(screen.queryByText("최신 학생 목록을 다시 확인해 주세요.")).not.toBeInTheDocument();
    expect(screen.getByText("가짜 학생")).toBeVisible();
  });
  it.each([401, 403])("같은 화면의 재갱신 %s도 마지막 성공 목록을 숨긴다", async status => {
    vi.useFakeTimers(); render(view()); await act(async () => { await Promise.resolve(); });
    const changed = vi.fn(); const unsubscribe = subscribeAdminPrivateCacheChanges(changed);
    await act(async () => { await vi.advanceTimersByTimeAsync(60000); });
    mocks.read.mockRejectedValue(new StudentDirectoryRequestError(status));
    fireEvent.click(screen.getByRole("button", { name: "다시 불러오기" }));
    await act(async () => { await vi.advanceTimersByTimeAsync(0); });
    expect(screen.queryByText("가짜 학생")).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: "관리자 로그인" })).toBeVisible();
    expect(changed).toHaveBeenCalledWith("identity", false);
    unsubscribe();
  });
  it("목록 DOM을 보존한 새로고침도 새 이름·인원·커서를 실제 화면에 반영한다", async () => {
    vi.useFakeTimers(); render(view()); await act(async () => { await Promise.resolve(); });
    const row = screen.getByText("가짜 학생");
    const search = screen.getByRole("searchbox", { name: "학생 및 학습 자료 검색" });
    await act(async () => { await vi.advanceTimersByTimeAsync(60000); });
    const next = response(); next.snapshot.page.items[0].displayName = "새 학생 이름";
    next.snapshot.page.items.push({ ...next.snapshot.page.items[0], id: "00000000-0000-4000-8000-000000000002", displayName: "추가 학생" });
    next.snapshot.totalCount = 3;
    mocks.read.mockResolvedValue({ ...next, snapshot: { ...next.snapshot, page: { ...next.snapshot.page, nextCursor: "new-cursor" } } });
    fireEvent.click(screen.getByRole("button", { name: "다시 불러오기" }));
    await act(async () => { await vi.advanceTimersByTimeAsync(0); });
    expect(screen.getByText("새 학생 이름")).toBe(row);
    expect(screen.getByText("추가 학생")).toBeVisible();
    expect(screen.getByRole("searchbox", { name: "학생 및 학습 자료 검색" })).toBe(search);
    expect(screen.getByRole("button", { name: "10명 더보기" })).toBeVisible();
    expect(screen.queryByText("이전에 불러온 학생 목록입니다. 최신 내용은 다시 불러와 확인할 수 있습니다.")).not.toBeInTheDocument();
  });
  it("실패 재시도 후 정상 탭 복귀는 강제갱신이 아닌 캐시 복원이다", async () => {
    mocks.read.mockRejectedValue(new StudentDirectoryRequestError(503)); render(view()); await screen.findByRole("alert");
    mocks.read.mockResolvedValue(response()); fireEvent.click(screen.getByRole("button", { name: "다시 불러오기" })); await screen.findByText("가짜 학생");
    act(() => window.dispatchEvent(new Event("pagehide"))); act(() => window.dispatchEvent(new Event("pageshow"))); await screen.findByText("가짜 학생");
    expect(mocks.read.mock.calls.at(-1)?.[0]).toMatchObject({ identity, studentIds: [id] });
  });
  it("검색 대기 250ms 전에 무효화해도 방금 입력한 검색을 복원한다", async () => {
    mocks.read.mockImplementation(async input => { const value = response(); value.snapshot.filters = input.filters; return value; });
    render(view()); await screen.findByText("가짜 학생");
    fireEvent.change(screen.getByRole("searchbox", { name: "학생 및 학습 자료 검색" }), { target: { value: "  새 검색  " } });
    act(() => announceStudentDirectoryRefresh()); await screen.findByText("가짜 학생");
    expect(screen.getByRole("searchbox", { name: "학생 및 학습 자료 검색" })).toHaveValue("새 검색");
    expect(mocks.read.mock.calls.at(-1)?.[0].filters.query).toBe("새 검색");
  });
});
