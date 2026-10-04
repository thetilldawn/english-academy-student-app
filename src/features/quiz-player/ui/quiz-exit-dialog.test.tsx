// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { QuizExitDialog } from "./quiz-exit-dialog";

beforeEach(() => {
  HTMLDialogElement.prototype.showModal=function(){this.setAttribute("open","");};
  HTMLDialogElement.prototype.close=function(){this.removeAttribute("open");};
});
afterEach(() => {cleanup();vi.restoreAllMocks();});
it("왼쪽 중단·오른쪽 계속을 구분하고 ESC는 계속하기로 닫는다", () => {
  const exit=vi.fn(),resume=vi.fn();
  render(<QuizExitDialog onExit={exit} onContinue={resume}/>);
  const buttons=screen.getAllByRole("button");
  expect(buttons.map(b=>b.textContent)).toEqual(["시험 중단","시험 계속"]);
  fireEvent.click(buttons[1]);expect(resume).toHaveBeenCalledTimes(1);expect(exit).not.toHaveBeenCalled();
  fireEvent.keyDown(screen.getByRole("dialog"),{key:"Escape"});expect(resume).toHaveBeenCalledTimes(2);
  fireEvent.click(buttons[0]);expect(exit).toHaveBeenCalledTimes(1);
});
