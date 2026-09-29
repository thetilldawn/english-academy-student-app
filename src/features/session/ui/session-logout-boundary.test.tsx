// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { createPortal } from "react-dom";
import { afterEach, expect, it, vi } from "vitest";
import { SessionLogoutBoundary } from "./session-logout-boundary";
import { AdminLogoutButton } from "@/components/admin-logout-button";
import { StudentLogoutButton } from "@/components/student-logout-button";
import { subscribeAdminPrivateCacheChanges } from "../controller/admin-private-cache-events";
import { usePrivateListSession } from "../controller/use-private-list-session";
const navigate=vi.hoisted(()=>vi.fn());
vi.mock("@/components/document-navigation",()=>({navigateDocument:navigate}));
vi.mock("next/navigation",()=>({useSelectedLayoutSegments:()=>["students"]}));
afterEach(()=>{cleanup();vi.resetAllMocks();vi.unstubAllGlobals();});
function privateCache(){
 let blocked=false,revision=0;const listeners=new Set<()=>void>();const clear=vi.fn();
 const notify=()=>{revision++;listeners.forEach(fn=>fn());};
 return { get blocked(){return blocked;},get revision(){return revision;},
 subscribe:(fn:()=>void)=>{listeners.add(fn);return()=>{listeners.delete(fn);};},
 lock:()=>{blocked=true;clear();notify();},invalidate:()=>{clear();notify();},cancelRequests:vi.fn(),clear};
}
it.each(["admin","student"] as const)("%s: 느린 로그아웃 중 본문/모달을 숨기고 성공시 인덱스 한 번만 이동",async role=>{
 let resolve!:(r:Response)=>void;
 const signal=vi.fn();const stop=subscribeAdminPrivateCacheChanges(signal);
 const fetch=vi.fn(()=>{
   expect(screen.queryByText("학생 비공개 목록")).not.toBeInTheDocument();
   expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
   expect(screen.getByRole("status")).toHaveTextContent("로그아웃 중");
   return new Promise<Response>(done=>{resolve=done;});
 });vi.stubGlobal("fetch",fetch);
 const cache=privateCache();
 function PrivatePage(){usePrivateListSession(cache);return <><p>{cache.blocked?"리스트 오류":"학생 비공개 목록"}</p>{createPortal(<div role="dialog">개인 상세창</div>,document.body)}</>;}
 render(<SessionLogoutBoundary role={role}>{role==="admin"?<AdminLogoutButton/>:<StudentLogoutButton/>}<PrivatePage/></SessionLogoutBoundary>);
 fireEvent.click(screen.getByRole("button",{name:role==="admin"?"로그아웃":"접속 종료"}));
 await waitFor(()=>expect(fetch).toHaveBeenCalledOnce());
 expect(screen.getByRole("status")).toHaveTextContent("로그아웃 중");
 expect(screen.queryByText("학생 비공개 목록")).not.toBeInTheDocument();expect(screen.queryByText("리스트 오류")).not.toBeInTheDocument();
 expect(screen.queryByRole("dialog")).not.toBeInTheDocument();expect(cache.clear).toHaveBeenCalled();
 if(role==="admin")expect(signal).toHaveBeenCalledWith("identity",false);
 await act(async()=>resolve(Response.json({})));
 expect(navigate).toHaveBeenCalledExactlyOnceWith("/",true);
 expect(screen.getByRole("status")).toHaveTextContent("로그아웃 중");stop();
});
it.each(["denied","network"] as const)("종료 %s 실패시 개인정보복원 없이 재시도만 제공한다",async failure=>{
 const fetch=vi.fn();if(failure==="denied")fetch.mockResolvedValueOnce(Response.json({}, {status:503}));else fetch.mockRejectedValueOnce(new Error("offline"));
 fetch.mockResolvedValueOnce(Response.json({}));vi.stubGlobal("fetch",fetch);
 render(<SessionLogoutBoundary role="student"><StudentLogoutButton/><p>개인 점수</p></SessionLogoutBoundary>);
 fireEvent.click(screen.getByRole("button",{name:"접속 종료"}));
 await screen.findByRole("alert");expect(navigate).not.toHaveBeenCalled();expect(screen.queryByText("개인 점수")).not.toBeInTheDocument();
 await act(async()=>fireEvent.click(screen.getByRole("button",{name:"다시 로그아웃"})));
 expect(fetch).toHaveBeenCalledTimes(2);expect(navigate).toHaveBeenCalledExactlyOnceWith("/",true);
});
