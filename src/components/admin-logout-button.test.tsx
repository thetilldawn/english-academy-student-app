// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { NavigationExitGuardProvider } from "./navigation-exit-guard";
import { useRouteExitGuard } from "./use-route-exit-guard";
import { AdminLogoutButton } from "./admin-logout-button";
import { SessionLogoutBoundary } from "@/features/session/public-client";
import { subscribeAdminPrivateCacheChanges } from "@/features/session/controller/admin-private-cache-events";
const navigate=vi.hoisted(()=>vi.fn());
vi.mock("@/components/document-navigation",()=>({navigateDocument:navigate}));
vi.mock("@/design-system/patterns/confirmation/confirmation",async original=>({
 ...await original<typeof import("@/design-system/patterns/confirmation/confirmation")>(),
 useConfirmation:()=>async(options:{message:string})=>window.confirm(options.message),
}));
function DirtyEditor(){useRouteExitGuard({busy:false,dirty:true,confirmMessage:"변경 내용을 버리고 이동할까요?",idPrefix:"logout-test"});return <><p>편집중인 개인자료</p><AdminLogoutButton/></>;}
function mount(){render(<SessionLogoutBoundary role="admin"><NavigationExitGuardProvider><DirtyEditor/></NavigationExitGuardProvider></SessionLogoutBoundary>);}
function release(){const state={...window.history.state};delete state.__routeExitGuardSentinel;window.history.replaceState(state,"",window.location.href);window.dispatchEvent(new PopStateEvent("popstate",{state}));}
beforeEach(()=>{window.history.replaceState({},"","/admin/students");vi.spyOn(window.history,"back").mockImplementation(()=>{});vi.spyOn(window,"confirm").mockReturnValue(true);});
afterEach(()=>{cleanup();vi.restoreAllMocks();vi.unstubAllGlobals();navigate.mockClear();window.history.replaceState({},"","/");});
it("이탈확인을 취소하면 DELETE나 개인정보 삭제 없이 편집화면을 유지한다",async()=>{
 const fetch=vi.fn();vi.stubGlobal("fetch",fetch);vi.mocked(window.confirm).mockReturnValue(false);
 const signal=vi.fn();const stop=subscribeAdminPrivateCacheChanges(signal);mount();
 await userEvent.click(screen.getByRole("button",{name:"로그아웃"}));
 expect(fetch).not.toHaveBeenCalled();expect(signal).not.toHaveBeenCalled();expect(screen.getByText("편집중인 개인자료")).toBeInTheDocument();stop();
});
it("승인 뒤 종료실패는 개인정보숨김을 유지하고 재시도 성공시 문서이동1회",async()=>{
 const fetch=vi.fn().mockResolvedValueOnce(Response.json({}, {status:503})).mockResolvedValueOnce(Response.json({}));vi.stubGlobal("fetch",fetch);mount();
 await userEvent.click(screen.getByRole("button",{name:"로그아웃"}));act(release);
 await screen.findByRole("alert");expect(screen.queryByText("편집중인 개인자료")).not.toBeInTheDocument();expect(navigate).not.toHaveBeenCalled();
 await userEvent.click(screen.getByRole("button",{name:"다시 로그아웃"}));expect(fetch).toHaveBeenCalledTimes(2);
 await waitFor(()=>expect(navigate).toHaveBeenCalledExactlyOnceWith("/",true));
});
