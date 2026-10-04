// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
const m=vi.hoisted(()=>({prepare:vi.fn(),prefetch:vi.fn(),push:vi.fn()}));
vi.mock("next/navigation",()=>({useRouter:()=>({push:m.push})}));
vi.mock("@/features/quiz-player/public-local-client",()=>({prepareLocalQuiz:m.prepare,prefetchLocalQuiz:m.prefetch,
  LocalQuizLoadingDialog:({onCancel}:{onCancel:()=>void})=><div role="dialog" aria-label="시험 준비 중"><span role="status">시험 준비 중</span><button onClick={onCancel}>취소</button></div>}));
import { StartAttemptButton } from "./start-attempt-button";
beforeEach(()=>{vi.resetAllMocks();m.prefetch.mockResolvedValue(undefined);});
afterEach(cleanup);
it("준비 중 취소하면 늦은 응답이 와도 시험으로 이동하지 않는다",async()=>{
  let resolve!:(url:string)=>void;m.prepare.mockReturnValue(new Promise(r=>{resolve=r;}));
  render(<StartAttemptButton assignmentId="fake"/>);fireEvent.click(screen.getByRole("button"));
  expect(screen.getByRole("dialog")).toHaveAccessibleName("시험 준비 중");
  fireEvent.click(screen.getByRole("button",{name:"취소"}));
  expect(m.prepare.mock.calls[0][1].aborted).toBe(true);
  await act(async()=>resolve("/quiz-offline#fake"));
  expect(m.push).not.toHaveBeenCalled();expect(screen.queryByRole("dialog")).toBeNull();
});
it("준비 성공은 기존 목록을 유지하는 경로 이동을 사용한다",async()=>{
  m.prepare.mockResolvedValue("/quiz-offline#fake");render(<StartAttemptButton assignmentId="fake"/>);
  await act(async()=>fireEvent.click(screen.getByRole("button")));
  expect(m.push).toHaveBeenCalledExactlyOnceWith("/quiz-offline#fake");
});
