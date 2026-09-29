// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { StudentCompletedAssignments } from "./student-completed-assignments";
import { useStudentCompletedAssignments } from "../controller/use-student-completed-assignments";

vi.mock("../controller/use-student-completed-assignments", () => ({ useStudentCompletedAssignments: vi.fn() }));
afterEach(() => { cleanup(); vi.clearAllMocks(); });

it("인증 거절 이후에는 완료 건수·개인 카드·더보기를 표시하지 않는다", () => {
  vi.mocked(useStudentCompletedAssignments).mockReturnValue({
    navigationRequired: true, error: "로그인이 필요합니다. 접속 화면으로 이동합니다.",
    items: [], nextCursor: null, loading: false, loadMore: vi.fn(),
  });
  render(<StudentCompletedAssignments initialPage={{ items: [], nextCursor: "private-cursor" }} nowMilliseconds={0} totalCount={57} />);
  expect(screen.getByRole("alert")).toHaveTextContent("로그인이 필요합니다.");
  expect(screen.queryByText("57건")).not.toBeInTheDocument();
  expect(screen.queryByRole("button", { name: /더보기/ })).not.toBeInTheDocument();
});
