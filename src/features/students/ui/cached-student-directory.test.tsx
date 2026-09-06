/** @vitest-environment jsdom */
import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ state: { blocked: false, snapshot: undefined as unknown, error: undefined as string | undefined, retry: vi.fn() } }));
vi.mock("../controller/use-cached-student-directory", () => ({ useCachedStudentDirectory: () => mocks.state }));
vi.mock("./student-directory", () => ({ StudentDirectory: () => <p>승인된 목록</p> }));
import { CachedStudentDirectory } from "./cached-student-directory";
afterEach(() => { cleanup(); mocks.state = { blocked: false, snapshot: undefined, error: undefined, retry: vi.fn() }; });
describe("개인 목록 상태 안내", () => {
  it("조회 중을 빈 결과와 구분한다", () => { render(<CachedStudentDirectory />); expect(screen.getByRole("status")).toHaveTextContent("학생 목록을 불러오는 중"); expect(screen.queryByText("승인된 목록")).not.toBeInTheDocument(); });
  it("실패에는 영역 안내와 실제 재시도 버튼을 제공한다", () => { mocks.state.error = "학생 목록을 불러오지 못했습니다. 다시 불러와 주세요."; render(<CachedStudentDirectory />); expect(screen.getByRole("alert")).toBeVisible(); fireEvent.click(screen.getByRole("button", { name: "다시 불러오기" })); expect(mocks.state.retry).toHaveBeenCalledOnce(); });
  it("권한 실패에는 예전 자료 대신 로그인 이동을 제공한다", () => { mocks.state.blocked = true; mocks.state.snapshot = {}; render(<CachedStudentDirectory />); expect(screen.queryByText("승인된 목록")).not.toBeInTheDocument(); expect(screen.getByRole("link", { name: "관리자 로그인" })).toHaveAttribute("href", "/admin/login"); });
});
