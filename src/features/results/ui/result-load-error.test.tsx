// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import StudentResultError from "@/app/student/(protected)/result/[id]/error";

afterEach(cleanup);

it("결과 오류에서 서버 재조회를 연결하며 안전한 안내를 표시한다", () => {
  const retry = vi.fn();
  render(<StudentResultError unstable_retry={retry} />);
  expect(screen.getByRole("alert")).toHaveTextContent("시험 결과를 불러오지 못했습니다. 잠시 후 다시 시도해 주세요.");
  expect(screen.queryByText(/페이지를 찾을 수/)).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "다시 시도" }));
  expect(retry).toHaveBeenCalledOnce();
});
