/** @vitest-environment jsdom */
import "@testing-library/jest-dom/vitest";
import { StrictMode } from "react";
import { renderToString } from "react-dom/server";
import { hydrateRoot } from "react-dom/client";
import type { DirectoryCacheResponse } from "../contracts/student-directory-cache-contract";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ pathname: "/admin/students", read: vi.fn() }));
vi.mock("next/navigation", () => ({ usePathname: () => mocks.pathname }));
vi.mock("../transport/student-directory-cache-read", () => ({ readStudentDirectoryCache: mocks.read }));
import { StudentDirectoryCacheProvider } from "./student-directory-cache-provider";
import { CachedStudentDirectory } from "../ui/cached-student-directory";
import { announceAdminPrivateCacheChange } from "@/features/session/public-client";
import { announceStudentDirectoryRefresh } from "./student-directory-events";
import { emptyStudentDirectoryFilters as filters } from "../contracts/student-directory-read-model";
import { StudentDirectoryRequestError } from "../contracts/student-directory-cache-contract";
const userId = "00000000-0000-4000-8000-000000000999", id = "00000000-0000-4000-8000-000000000001", identity = "a".repeat(64);
function response() { return { kind: "snapshot", identity, userId, snapshot: { filters, filterOptions: { classGroups: [], grades: [], schools: [], wordbooks: [] }, snapshotAt: "2026-09-06T00:00:00Z", totalCount: 1, page: { nextCursor: null, items: [{ id, displayName: "가짜 학생", schoolName: null, gradeLabel: null, status: "active", codeStatus: "active", currentVocabBook: null, recentExamAt: null, rawPoints: 30, completedCount: 0, missedCount: 0, notStartedCount: 0 }] } } }; }
function view(owner = userId, initialResponse?: Extract<DirectoryCacheResponse, { kind: "snapshot" }>) { return <StrictMode><StudentDirectoryCacheProvider userId={owner}>{mocks.pathname === "/admin/students" ? <CachedStudentDirectory initialResponse={initialResponse} /> : <p>다른 화면</p>}</StudentDirectoryCacheProvider></StrictMode>; }
beforeEach(() => { mocks.pathname = "/admin/students"; mocks.read.mockReset().mockImplementation(async () => response()); });
afterEach(() => { cleanup(); vi.useRealTimers(); });
describe("실제 학생 목록과 개인 캐시 연결", () => {
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
  it("표시 상한이 지나면 주기 조회 없이 숨기고 재시도를 제공한다", async () => {
    vi.useFakeTimers(); render(view()); await act(async () => { await Promise.resolve(); });
    expect(screen.getByText("가짜 학생")).toBeVisible(); const count = mocks.read.mock.calls.length;
    await act(async () => { await vi.advanceTimersByTimeAsync(60000); });
    expect(screen.queryByText("가짜 학생")).not.toBeInTheDocument(); expect(mocks.read).toHaveBeenCalledTimes(count);
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
    expect(screen.queryByText("가짜 학생")).not.toBeInTheDocument();
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
