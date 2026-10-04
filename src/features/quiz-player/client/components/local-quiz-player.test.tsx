// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { webcrypto } from "node:crypto";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
const m=vi.hoisted(()=>({controller:vi.fn(),stop:vi.fn(),back:vi.fn(),replace:vi.fn()}));
vi.mock("next/navigation",()=>({useRouter:()=>({back:m.back,replace:m.replace}),usePathname:()=>window.location.pathname}));
vi.mock("../controllers/use-local-quiz-player-controller",()=>({useLocalQuizPlayerController:m.controller}));
vi.mock("../../controller/use-quiz-audio",()=>({useQuizAudio:()=>({stopAudio:m.stop,playAudio:vi.fn()})}));
import { localFixture } from "../../test-support/local-quiz-fixtures";
import { LocalQuizPlayer } from "./local-quiz-player";
beforeEach(async()=>{
  vi.resetAllMocks();vi.stubGlobal("crypto",webcrypto);
  HTMLDialogElement.prototype.showModal=function(){this.setAttribute("open","");};
  HTMLDialogElement.prototype.close=function(){this.removeAttribute("open");};
  const fixture=await localFixture();
  window.history.replaceState(null,"",`/quiz-offline#${fixture.run.key}`);
  m.controller.mockReturnValue({...fixture,view:"playing",remaining:5000,busy:false,pendingChoice:null,feedback:null,error:"",choose:vi.fn()});
});
afterEach(()=>{cleanup();vi.unstubAllGlobals();});
it("시험 중지는 음성을 끊고 계속/중단 선택 뒤에만 목록으로 나간다",()=>{
  render(<LocalQuizPlayer presentation="dialog"/>);
  fireEvent.click(screen.getByRole("button",{name:"시험 중지"}));expect(m.stop).toHaveBeenCalled();
  expect(screen.getByRole("dialog",{name:"시험을 중단할까요?"})).toBeVisible();
  fireEvent.click(screen.getByRole("button",{name:"시험 계속"}));expect(m.back).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button",{name:"시험 중지"}));fireEvent.click(screen.getByRole("button",{name:"시험 중단"}));
  expect(m.back).toHaveBeenCalledTimes(1);
});
it("기기 답 저장 실패 때 ESC는 남은 선택을 버리고 나가지 않는다",()=>{
  m.controller.mockReturnValue({...m.controller(),view:"failed",busy:true,pendingChoice:1,error:"저장 재시도"});
  render(<LocalQuizPlayer presentation="dialog"/>);
  expect(screen.getByRole("button",{name:"시험 중지"})).toBeDisabled();
  fireEvent.keyDown(screen.getByRole("dialog",{name:"단어 시험"}),{key:"Escape"});expect(m.back).not.toHaveBeenCalled();
});
it("취소 뒤 같은 시험에 다시 진입하면 보존된 화면도 새 주소의 시험 키를 읽는다",()=>{
  const key = window.location.hash;
  const view = render(<LocalQuizPlayer presentation="dialog"/>);
  window.history.pushState(null,"","/student");
  view.rerender(<LocalQuizPlayer presentation="dialog"/>);
  window.history.pushState(null,"",`/quiz-offline${key}`);
  view.rerender(<LocalQuizPlayer presentation="dialog"/>);
  expect(screen.getByRole("button",{name:"시험 중지"})).toBeVisible();
  expect(screen.queryByText("시험 목록에서 시험을 선택해 주세요.")).not.toBeInTheDocument();
});
it("라우터가 같은 시험 주소의 키를 두 번 붙여도 기존 키 하나로 복구한다",()=>{
  const key = window.location.hash;
  window.history.replaceState({ retained: true },"",`/quiz-offline${key}${key}`);
  render(<LocalQuizPlayer presentation="dialog"/>);
  expect(screen.getByRole("button",{name:"시험 중지"})).toBeVisible();
  expect(window.location.hash).toBe(key);
  expect(window.history.state).toEqual({retained:true});
});
