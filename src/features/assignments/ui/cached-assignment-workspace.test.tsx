// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { useState } from "react";
import { afterEach, expect, it, vi } from "vitest";
import type { StudentDirectorySnapshot } from "@/features/students/public-contracts";
const state = vi.hoisted(() => ({ value: {} as { blocked: boolean; stale?: boolean; refreshing?: boolean; error?: string; snapshot?: StudentDirectorySnapshot; retainedSnapshot?: StudentDirectorySnapshot; retry: () => void } }));
vi.mock("@/features/students/public-client", () => ({ useCachedStudentDirectory: () => state.value, useStudentDirectoryCache: () => null }));
vi.mock("./assignment-workspace", () => ({ AssignmentWorkspace: ({ interactionAllowed }: { interactionAllowed: boolean }) => {
  const [value] = useState("가짜 작성 자료"); return <p data-enabled={interactionAllowed}>{value}</p>;
} }));
import { CachedAssignmentWorkspace } from "./cached-assignment-workspace";
afterEach(cleanup);
const props = { initialDatasetId: "", initialStudentId: "", initialDialogView: "overview" as const };
it("현재 인증 자료가 없는 오류는 보관 자료를 숨기며 확정 인증 실패는 제거한다", () => {
  const retained = {} as StudentDirectorySnapshot;
  state.value = { blocked: false, snapshot: retained, retainedSnapshot: retained, retry: vi.fn() };
  const { rerender } = render(<CachedAssignmentWorkspace {...props} />);
  const content = screen.getByText("가짜 작성 자료"); expect(content).toBeVisible();
  state.value = { ...state.value, snapshot: undefined, error: "학생 목록을 불러오지 못했습니다." };
  rerender(<CachedAssignmentWorkspace {...props} />);
  expect(content).not.toBeVisible(); expect(content).toHaveAttribute("data-enabled", "false");
  expect(screen.getByRole("button", { name: "다시 불러오기" })).toBeVisible();
  state.value = { ...state.value, blocked: true }; rerender(<CachedAssignmentWorkspace {...props} />);
  expect(screen.queryByText("가짜 작성 자료")).not.toBeInTheDocument();
});
it("현재 인증 자료가 있는 오래된 목록은 중립 안내와 갱신 잠금으로 구분한다", () => {
  const retained = {} as StudentDirectorySnapshot;
  state.value = { blocked: false, stale: true, snapshot: retained, retainedSnapshot: retained, retry: vi.fn() };
  const { rerender } = render(<CachedAssignmentWorkspace {...props} />);
  expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  expect(screen.getByRole("status")).toHaveTextContent("작성 중인 배정은 유지됩니다.");
  const content = screen.getByText("가짜 작성 자료"); expect(content).toBeVisible();
  state.value = { ...state.value, refreshing: true }; rerender(<CachedAssignmentWorkspace {...props} />);
  expect(content).toHaveAttribute("data-enabled", "true");
  expect(screen.getByRole("status")).toHaveTextContent("학생 목록을 새로 불러오는 중입니다.");
  expect(screen.getByRole("button", { name: "다시 불러오기" })).toBeDisabled();
});
