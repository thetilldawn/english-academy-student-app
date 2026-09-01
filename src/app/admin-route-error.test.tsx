// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { commonText } from "@/content/ko/common";
import AssignmentsError from "./admin/(protected)/assignments/error";
import ResultsError from "./admin/(protected)/results/error";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe.each([
  {
    Component: ResultsError,
    title: "내역을 불러오지 못했습니다",
    description:
      "시험 내역은 변경되지 않았습니다. 잠시 뒤 다시 불러와 주세요.",
    event: "client.admin_history_error_boundary",
  },
  {
    Component: AssignmentsError,
    title: "단어 배정 화면을 불러오지 못했습니다",
    description:
      "입력 중이던 내용은 저장되지 않았습니다. 잠시 뒤 다시 불러와 주세요.",
    event: "client.assignment_workspace_error_boundary",
  },
])("관리자 경로 오류 복구: $title", ({ Component, title, description, event }) => {
  it("안전한 설명과 오류번호를 표시하고 재시도를 연결한다", () => {
    const reset = vi.fn();
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
    const error = Object.assign(new Error("private server detail"), {
      digest: "safe_123",
    });

    render(<Component error={error} reset={reset} />);

    expect(screen.getByRole("alert")).toHaveTextContent(description);
    expect(screen.getByRole("heading", { name: title })).toBeVisible();
    expect(screen.getByText("next_safe_123")).toBeVisible();
    expect(screen.queryByText("private server detail")).not.toBeInTheDocument();

    fireEvent.click(
      screen.getByRole("button", { name: commonText.errorBoundary.retry }),
    );

    expect(reset).toHaveBeenCalledOnce();
    expect(consoleError).toHaveBeenCalledWith(expect.stringContaining(event));
  });
});
