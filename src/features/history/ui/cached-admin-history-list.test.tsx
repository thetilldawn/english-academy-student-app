// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { renderToString } from "react-dom/server";
import { hydrateRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AdminHistoryListItem } from "../contracts/admin-history-read-model";
import type { HistoryCacheSeed } from "../contracts/history-list-cache-contract";
const mocks = vi.hoisted(() => ({ pathname: "/admin/results", read: vi.fn(), initial: vi.fn(), section: vi.fn(), more: vi.fn() }));
vi.mock("next/navigation", () => ({ usePathname: () => mocks.pathname }));
vi.mock("../transport/history-pages", () => ({ readHistoryListCache: mocks.read, loadAdminHistorySnapshot: mocks.initial, loadAdminHistoryFreshSection: mocks.section, loadAdminHistoryNextPage: mocks.more }));
import { HistoryListCacheProvider } from "../controller/history-list-cache-provider";
import { CachedAdminHistoryList } from "./cached-admin-history-list";
import { announceAdminHistoryMutation } from "../controller/admin-history-mutation-events";
import { announceAdminPrivateCacheChange, subscribeAdminPrivateCacheChanges } from "@/features/session/public-client";
import { AdminHistoryRequestError } from "../contracts/admin-history-request-error";

const userId = "00000000-0000-4000-8000-000000000999", identity = "a".repeat(64), stamp = "2026-09-06T00:00:01.000900Z";
const item: AdminHistoryListItem = {
  activityAt: stamp, assignedAt: stamp, assignmentId:"00000000-0000-4000-8000-000000000001",
  assignmentPurpose:"regular", assignmentTitle:"가짜 시험", attemptId:null, availableUntil:null, cancelledAt:null, completedAt:null, datasetTitle:"검사 단어장",
  deadlineAt:null, finalScore:null, id:"local-first", initialCompletedAt:null, initialScore:null, missedAt:null, passed:null, passingScore:80, phase:null,
  primaryUnitLabels:["DAY 01"], questionCount:20, retryStartedAt:null, startedAt:null, status:"not_started", studentId:"00000000-0000-4000-8000-000000000002", studentName:"가짜 내역 학생", unitLabels:["DAY 01"],
};
function response(version=stamp): HistoryCacheSeed {
  return { kind:"snapshot",identity,userId,snapshot:{currentOnly:false,query:"",statusFilter:"all",snapshotAt:version,
    sections:["open","needs_attention","completed","archived"].map(groupKey=>({groupKey,items:groupKey==="open"?[item]:[],nextCursor:groupKey==="open"?"old-cursor":null,totalCount:groupKey==="open"?11:0}))} };
}
function view(seed?: HistoryCacheSeed, owner=userId) {
  return <HistoryListCacheProvider userId={owner}>{mocks.pathname==="/admin/results"?<CachedAdminHistoryList initialResponse={seed}/>:<p>다른 화면</p>}</HistoryListCacheProvider>;
}
beforeEach(()=>{vi.clearAllMocks();mocks.pathname="/admin/results";mocks.read.mockImplementation(async input=>({...response(),snapshot:{...response().snapshot,...input.filters}}));});
afterEach(()=>{cleanup();vi.useRealTimers();});
describe("실제 내역 첫 목록과 개인 캐시",()=>{
  it.each([false,true])("거절된 커서의 복구 실패=%s 후 왕복에도 옛 커서를 복원하지 않는다",async fail=>{
    const {rerender}=render(view());await screen.findByText("가짜 내역 학생");
    mocks.more.mockRejectedValue(new AdminHistoryRequestError("invalid-request"));
    const next=response("2026-09-06T00:00:02.000900Z");next.snapshot.sections[0].nextCursor="new-cursor";
    if(fail)mocks.read.mockRejectedValueOnce(new AdminHistoryRequestError("unavailable"));else mocks.read.mockResolvedValueOnce(next);
    const count=mocks.read.mock.calls.length;fireEvent.click(screen.getByRole("button",{name:"10개 더보기"}));
    if(fail)await screen.findByRole("alert");else await screen.findByText("가짜 내역 학생");
    await waitFor(()=>expect(mocks.read).toHaveBeenCalledTimes(count+1));expect(mocks.read.mock.calls.at(-1)?.[0].identity).toBeUndefined();
    mocks.pathname="/admin/students";rerender(view());
    mocks.read.mockImplementation(async input=>input.identity?{kind:"resume",userId,identity}:next);
    mocks.pathname="/admin/results";rerender(view());await screen.findByText("가짜 내역 학생");
    mocks.more.mockResolvedValue({items:[],nextCursor:null});fireEvent.click(screen.getByRole("button",{name:"10개 더보기"}));
    expect(mocks.more.mock.calls.at(-1)?.[0].cursor).toBe("new-cursor");
    expect(mocks.initial).not.toHaveBeenCalled();
  });
  it("문서 hydration은 중복 조회 없이 인계하되 Client seed는 현재 인증으로 쓰지 않는다",async()=>{
    const host=document.createElement("div");host.innerHTML=renderToString(view(response()));document.body.appendChild(host);let root!:ReturnType<typeof hydrateRoot>;
    try{await act(async()=>{root=hydrateRoot(host,view(response()));});expect(screen.getByText("가짜 내역 학생")).toBeVisible();expect(mocks.read).not.toHaveBeenCalled();}
    finally{await act(async()=>root.unmount());host.remove();}
    mocks.read.mockImplementation(()=>new Promise(()=>{}));render(view(response()));expect(screen.queryByText("가짜 내역 학생")).not.toBeInTheDocument();
  });
  it("왕복은 현재 인증 전 숨기고 확인 후 같은 목록을 복원한다",async()=>{
    const {rerender}=render(view());await screen.findByText("가짜 내역 학생");
    mocks.pathname="/admin/students";rerender(view());let finish!:(value:unknown)=>void;
    mocks.read.mockImplementation(()=>new Promise(resolve=>{finish=resolve;}));mocks.pathname="/admin/results";rerender(view(response()));
    expect(screen.queryByText("가짜 내역 학생")).not.toBeInTheDocument();
    await act(async()=>finish({kind:"resume",userId,identity}));
    expect(screen.getByText("가짜 내역 학생")).toBeVisible();expect(mocks.read.mock.calls.at(-1)?.[0].identity).toBe(identity);
  });
  it("검색 입력 직후 변경도 조건을 보존하고 첫 목록1회/구역0회만 읽는다",async()=>{
    render(view());await screen.findByText("가짜 내역 학생");
    fireEvent.change(screen.getByRole("searchbox"),{target:{value:"  새 검색 "}});
    const before=mocks.read.mock.calls.length;
    act(()=>announceAdminPrivateCacheChange("students"));
    await screen.findByText("가짜 내역 학생");expect(screen.getByRole("searchbox")).toHaveValue("새 검색");
    expect(mocks.read).toHaveBeenCalledTimes(before+1);expect(mocks.read.mock.calls.at(-1)?.[0]).toMatchObject({filters:{query:"새 검색"}});
    expect(mocks.initial).not.toHaveBeenCalled();expect(mocks.section).not.toHaveBeenCalled();
  });
  it("숨김 영수증 뒤 첫 목록1회, 옛 더보기 요청 취소와 늦은 결과 차단",async()=>{
    render(view());await screen.findByText("가짜 내역 학생");
    let finishMore!:(value:unknown)=>void;mocks.more.mockImplementation(()=>new Promise(resolve=>{finishMore=resolve;}));
    fireEvent.click(screen.getByRole("button",{name:"10개 더보기"}));const moreSignal=mocks.more.mock.calls[0][1] as AbortSignal;
    const next=response("2026-09-06T00:00:02.000900Z");next.snapshot.sections.forEach(s=>{s.items=[];s.totalCount=0;s.nextCursor=null;});
    mocks.read.mockResolvedValue(next);const before=mocks.read.mock.calls.length;const signals=vi.fn();const unsubscribe=subscribeAdminPrivateCacheChanges(signals);
    act(()=>announceAdminHistoryMutation({before:item,after:null,receipt:{assignmentId:item.assignmentId,studentId:item.studentId,attemptId:null,kind:"hidden",version:next.snapshot.snapshotAt}}));
    await screen.findByText("배정된 학습이 없습니다.");expect(moreSignal.aborted).toBe(true);expect(mocks.read).toHaveBeenCalledTimes(before+1);
    expect(mocks.read.mock.calls.at(-1)?.[0].identity).toBeUndefined();expect(mocks.initial).not.toHaveBeenCalled();expect(mocks.section).not.toHaveBeenCalled();expect(signals).toHaveBeenCalledTimes(1);
    await act(async()=>finishMore({items:[{...item,id:"late",studentName:"늦은 학생"}],nextCursor:"late-cursor"}));
    expect(screen.queryByText("늦은 학생")).not.toBeInTheDocument();expect(screen.queryByRole("button",{name:"10개 더보기"})).not.toBeInTheDocument();unsubscribe();
  });
  it.each(["unauthenticated","forbidden"] as const)("현재 %s 또는 로그아웃은 행·개수·더보기 전체를 숨긴다",async kind=>{
    render(view());await screen.findByText("가짜 내역 학생");
    mocks.read.mockRejectedValue(new AdminHistoryRequestError(kind));act(()=>window.dispatchEvent(new Event("pageshow")));
    await screen.findByRole("link",{name:"관리자 로그인"});expect(screen.queryByText("가짜 내역 학생")).not.toBeInTheDocument();expect(screen.queryByText("11건")).not.toBeInTheDocument();
    expect(screen.queryByRole("button",{name:"10개 더보기"})).not.toBeInTheDocument();
    const count=mocks.read.mock.calls.length;act(()=>announceAdminPrivateCacheChange("identity"));expect(mocks.read).toHaveBeenCalledTimes(count);
  });
  it("표시 만료는 주기 조회를 만들지 않고 새로 확인할 안내를 준다",async()=>{
    vi.useFakeTimers();render(view());await act(async()=>{await Promise.resolve();});expect(screen.getByText("가짜 내역 학생")).toBeVisible();
    const count=mocks.read.mock.calls.length;await act(async()=>{await vi.advanceTimersByTimeAsync(60000);});
    expect(screen.queryByText("가짜 내역 학생")).not.toBeInTheDocument();expect(mocks.read).toHaveBeenCalledTimes(count);expect(screen.getByRole("button",{name:"다시 시도"})).toBeVisible();
    expect(screen.getByText("최신 시험 내역을 다시 확인해 주세요.")).toBeVisible();
  });
  it("계정 교체/일반 실패/재시도도 예전 목록을 개인 인증 근거로 쓰지 않는다",async()=>{
    const {rerender}=render(view());await screen.findByText("가짜 내역 학생");
    mocks.read.mockRejectedValue(new Error("private SQL"));rerender(view(undefined,"00000000-0000-4000-8000-000000000888"));
    await screen.findByRole("alert");expect(screen.queryByText("가짜 내역 학생")).not.toBeInTheDocument();expect(screen.queryByText(/private SQL/)).not.toBeInTheDocument();
    mocks.read.mockResolvedValue({...response(),userId:"00000000-0000-4000-8000-000000000888"});fireEvent.click(screen.getByRole("button",{name:"다시 시도"}));await screen.findByText("가짜 내역 학생");
  });
  it("만료 뒤 조회 실패에서도 실제 오류를 만료 문구로 덮지 않는다", async () => {
    vi.useFakeTimers(); render(view()); await act(async () => { await Promise.resolve(); });
    await act(async () => { await vi.advanceTimersByTimeAsync(60000); });
    mocks.read.mockRejectedValue(new AdminHistoryRequestError("unavailable"));
    fireEvent.click(screen.getByRole("button", { name: "다시 시도" }));
    await act(async () => { await vi.advanceTimersByTimeAsync(0); });
    expect(screen.getByRole("alert")).not.toHaveTextContent("최신 시험 내역을 다시 확인해 주세요.");
    expect(screen.getByRole("alert")).toHaveTextContent("불러오지 못했습니다");
    expect(screen.queryByText("가짜 내역 학생")).not.toBeInTheDocument();
  });
  it("StrictMode 재실행 후에도 표시/현재 재인증이 회복된다",async()=>{
    render(view(),{reactStrictMode:true});await screen.findByText("가짜 내역 학생");
    act(()=>window.dispatchEvent(new Event("pagehide")));expect(screen.queryByText("가짜 내역 학생")).not.toBeInTheDocument();
    act(()=>window.dispatchEvent(new Event("pageshow")));await waitFor(()=>expect(screen.getByText("가짜 내역 학생")).toBeVisible());
  });
});
