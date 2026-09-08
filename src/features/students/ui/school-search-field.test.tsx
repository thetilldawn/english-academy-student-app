// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { SchoolSearchField } from "./school-search-field";
import type { SchoolSearchController } from "../controller/use-school-search";
import { schoolSearchMessages } from "../contracts/school-search-contract";
afterEach(cleanup);
const controller = (fields: Partial<SchoolSearchController> = {}): SchoolSearchController => ({
  value: "가짜", status: "idle", locked: false, items: [], hasMore: false, message: schoolSearchMessages.idle,
  actions: { change: vi.fn(), choose: vi.fn(), retry: vi.fn(), reset: vi.fn() }, ...fields,
});
it("공용 입력 이름과 수동 입력을 유지하고 idle은 오류나 로딩이 아니다", () => {
  const input = controller(); render(<SchoolSearchField controller={input} />);
  expect(screen.getByRole("textbox", { name: "학교" })).toHaveAttribute("name", "schoolName");
  fireEvent.change(screen.getByRole("textbox"), { target: { value: "직접학교" } }); expect(input.actions.change).toHaveBeenCalledWith("직접학교");
  expect(screen.queryByRole("status")).toBeNull(); expect(screen.queryByRole("alert")).toBeNull();
});
it("학교와 지역이 함께 선택되며 결과가 더 있으면 구체화 안내를 준다", () => {
  const input = controller({ status: "ready", items: [{ id: "fake1", name: "가짜학교", region: "가짜 지역" }], hasMore: true });
  render(<SchoolSearchField controller={input} />); fireEvent.click(screen.getByRole("button", { name: "가짜학교 가짜 지역" }));
  expect(input.actions.choose).toHaveBeenCalledWith("fake1"); expect(screen.getByText(/결과가 더 있습니다/)).toBeVisible();
});
it("조회 실패도 입력은 사용 가능하고 다시 검색만 명시 실행한다", () => {
  const input = controller({ status: "error", message: schoolSearchMessages.error }); render(<SchoolSearchField controller={input} />);
  expect(screen.getByRole("textbox")).toBeEnabled(); expect(screen.getByRole("alert")).toHaveTextContent("직접 입력");
  fireEvent.click(screen.getByRole("button", { name: "다시 검색" })); expect(input.actions.retry).toHaveBeenCalledOnce();
});
