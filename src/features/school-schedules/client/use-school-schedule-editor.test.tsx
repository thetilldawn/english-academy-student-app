// @vitest-environment jsdom
import { act, cleanup, renderHook, render, screen, fireEvent, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { fakeSchoolBundle as bundle } from "../school-schedule.fixture";
import { buildSchoolSummary } from "../domain/school-schedule";
import type { ScheduleEditCommand, ScheduleEditorInitial } from "../contracts/school-schedule-edit";
const mocks=vi.hoisted(()=>({save:vi.fn(),read:vi.fn(),recover:vi.fn(),announce:vi.fn(),refresh:vi.fn()}));
vi.mock("next/navigation",()=>({useRouter:()=>({refresh:mocks.refresh})}));
vi.mock("@/components/use-route-exit-guard",()=>({useRouteExitGuard:()=>({canExit:async()=>true,requestExit:vi.fn()})}));
vi.mock("../actions/edit-school-schedule",()=>({saveSchoolScheduleEventAction:mocks.save,readSchoolScheduleEditorAction:mocks.read,readSchoolScheduleSaveResultAction:mocks.recover}));
vi.mock("@/features/session/public-client",()=>({announceAdminPrivateCacheChange:mocks.announce}));
import { useSchoolScheduleEditor } from "./use-school-schedule-editor";
import { SchoolScheduleEditor } from "./components/school-schedule-editor";
const summary=buildSchoolSummary({schoolKey:bundle.schoolKey,schoolName:bundle.schoolName,gradeLabel:"고2"},[bundle],"2026-09-14");
const snapshot={schoolKey:bundle.schoolKey,academicYear:2026,semester:2,sourceVersionId:bundle.versionId,manualRevision:0,
  groups:[{schoolKey:bundle.schoolKey,schoolName:bundle.schoolName,schoolLevel:"고" as const,grade:2,gradeLabel:"고2",studentCount:2}],events:bundle.events,sourceChangedEventIds:[]};
const initial:ScheduleEditorInitial={overview:{status:"ready",today:summary.today,groups:[{summary,studentCount:2}]},scope:{schoolKey:bundle.schoolKey,academicYear:2026,semester:2},grade:2,eventId:bundle.events[0].id,result:{ok:true,snapshot}};
const receipt=(command:ScheduleEditCommand)=>({requestId:command.requestId,eventId:command.event.id,revision:1,schoolKey:command.schoolKey,academicYear:command.academicYear,semester:command.semester});
beforeEach(()=>{vi.resetAllMocks();mocks.read.mockResolvedValue({ok:true,snapshot});});
afterEach(()=>{cleanup();vi.useRealTimers();});
it("변경 원복은 미저장이 아니며 저장 중 중복 호출을 차단한다",async()=>{
  let done!:(value:unknown)=>void;mocks.save.mockImplementation(()=>new Promise(resolve=>{done=resolve;}));
  const {result}=renderHook(()=>useSchoolScheduleEditor(initial));
  act(()=>result.current.change({title:"수정"}));expect(result.current.dirty).toBe(true);
  act(()=>result.current.change({title:bundle.events[0].title}));expect(result.current.dirty).toBe(false);
  act(()=>result.current.change({title:"최종 수정"}));
  let saving!:Promise<void>;act(()=>{saving=result.current.save();});
  await act(async()=>{await result.current.save();});expect(mocks.save).toHaveBeenCalledTimes(1);
  const command=mocks.save.mock.calls[0][0];
  await act(async()=>{done({ok:true,receipt:receipt(command)});await saving;});
  expect(result.current.dirty).toBe(false);expect(result.current.draft.title).toBe("최종 수정");expect(mocks.announce).toHaveBeenCalledWith("students");
});
it("충돌 뒤 최신 기준을 불러와도 초안은 보존한다",async()=>{
  mocks.save.mockResolvedValue({ok:false,status:409,error:"충돌"});
  const {result}=renderHook(()=>useSchoolScheduleEditor(initial));
  act(()=>result.current.change({title:"내 초안"}));await act(async()=>result.current.save());
  expect(result.current.problem).toBe("conflict");expect(result.current.draft.title).toBe("내 초안");
  mocks.read.mockResolvedValue({ok:true,snapshot:{...snapshot,manualRevision:7,sourceVersionId:"new-source"}});
  await act(async()=>result.current.load(undefined,undefined,true));
  expect(result.current.snapshot?.manualRevision).toBe(7);expect(result.current.draft.title).toBe("내 초안");expect(result.current.dirty).toBe(true);
});
it("응답 유실은 자동 재저장 없이 읽기로 복구하고 입력 변경·새 요청을 차단한다",async()=>{
  mocks.save.mockRejectedValue(new Error("network"));
  const {result}=renderHook(()=>useSchoolScheduleEditor(initial));
  act(()=>result.current.change({title:"보존"}));await act(async()=>result.current.save());
  expect(result.current.unresolved).toBe(true);
  act(()=>result.current.change({title:"덮기"}));expect(result.current.draft.title).toBe("보존");
  await act(async()=>result.current.save());expect(mocks.save).toHaveBeenCalledTimes(1);
  mocks.recover.mockResolvedValue({ok:true,receipt:null});await act(async()=>result.current.recover());
  expect(result.current.unresolved).toBe(true);expect(mocks.save).toHaveBeenCalledTimes(1);
  const command=mocks.save.mock.calls[0][0];mocks.recover.mockResolvedValue({ok:true,receipt:receipt(command)});
  await act(async()=>result.current.recover());expect(result.current.unresolved).toBe(false);expect(result.current.dirty).toBe(false);
});
it("사용자가 같은 요청 재저장을 선택할 때 원래 ID·내용을 그대로 보낸다",async()=>{
  mocks.save.mockResolvedValueOnce({ok:false,status:503,outcome:"unknown",error:"불명"});
  const {result}=renderHook(()=>useSchoolScheduleEditor(initial));act(()=>result.current.change({title:"수정"}));
  await act(async()=>result.current.save());const first=mocks.save.mock.calls[0][0];
  mocks.save.mockResolvedValueOnce({ok:true,receipt:receipt(first)});
  await act(async()=>result.current.save(true));expect(mocks.save.mock.calls[1][0]).toEqual(first);
});
it("인증 실패면 학교와 입력을 숨기고 다른 화면의 개인 캐시도 잠근다",async()=>{
  mocks.save.mockResolvedValue({ok:false,status:401,error:"관리자 로그인이 필요합니다."});
  const {result}=renderHook(()=>useSchoolScheduleEditor(initial));act(()=>result.current.change({title:"입력"}));
  await act(async()=>result.current.save());expect(result.current.locked).toBe(true);expect(result.current.snapshot).toBeNull();expect(result.current.draft.title).toBe("");
  expect(mocks.announce).toHaveBeenCalledWith("identity");
});
it("느린 저장이 제한 시간을 넘으면 초안을 보존하고 결과 확인으로 전환한다",async()=>{
  vi.useFakeTimers();mocks.save.mockImplementation(()=>new Promise(()=>{}));
  const {result}=renderHook(()=>useSchoolScheduleEditor(initial));act(()=>result.current.change({title:"보존"}));
  let saving!:Promise<void>;act(()=>{saving=result.current.save();});
  await act(async()=>{await vi.advanceTimersByTimeAsync(20001);await saving;});
  expect(result.current.unresolved).toBe(true);expect(result.current.busy).toBe(false);expect(result.current.draft.title).toBe("보존");
});
it("결과 확인 도중 인증이 만료돼도 로그인과 닫기를 막는 미확정 상태를 남기지 않는다",async()=>{
  mocks.save.mockRejectedValue(new Error("network"));
  const {result}=renderHook(()=>useSchoolScheduleEditor(initial));act(()=>result.current.change({title:"입력"}));
  await act(async()=>result.current.save());expect(result.current.unresolved).toBe(true);
  mocks.recover.mockResolvedValue({ok:false,status:401,error:"로그인 필요"});
  await act(async()=>result.current.recover());
  expect(result.current.locked).toBe(true);expect(result.current.unresolved).toBe(false);expect(result.current.dirty).toBe(false);
});
it("첫 학교 목록 조회 실패를 다시 불러온 뒤 학교를 선택해 입력할 수 있다",async()=>{
  const failed={...initial,overview:{status:"error" as const,today:initial.overview.today,groups:[]},scope:null,result:null};
  const {rerender}=render(<SchoolScheduleEditor initial={failed} presentation="page" />);
  expect(screen.getByRole("alert").textContent).toContain("학교 목록을 불러오지 못했습니다");
  fireEvent.click(screen.getByRole("button",{name:"다시 시도"}));expect(mocks.refresh).toHaveBeenCalledTimes(1);
  rerender(<SchoolScheduleEditor initial={initial} presentation="page" />);
  fireEvent.change(screen.getByLabelText("학교·학년"),{target:{value:"0"}});
  await waitFor(()=>expect(screen.getByLabelText("일정 이름")).toBeTruthy());
  expect(screen.getByRole("button",{name:"변경사항 저장"})).toBeTruthy();
});
