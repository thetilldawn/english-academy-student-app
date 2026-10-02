// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { Tabs } from "./tabs";
afterEach(cleanup);
it("offers one keyboard entry without silently selecting an unset value",()=>{
  const change=vi.fn();render(<Tabs ariaLabel="종류" value="" onChange={change} items={[{value:"a",label:"잠김",disabled:true},{value:"b",label:"첫 종류"},{value:"c",label:"다음 종류"}]} />);
  expect(screen.getByRole("tab",{name:"첫 종류"})).toHaveAttribute("tabindex","0");expect(screen.getAllByRole("tab").every(t=>t.getAttribute("aria-selected")==="false")).toBe(true);expect(change).not.toHaveBeenCalled();
  screen.getByRole("tab",{name:"첫 종류"}).focus();fireEvent.keyDown(document.activeElement!,{key:"ArrowRight"});expect(change).toHaveBeenCalledWith("c");expect(screen.getByRole("tab",{name:"다음 종류"})).toHaveFocus();
});
