// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { BulkExamFields } from "./bulk-exam-fields";

afterEach(cleanup);

function controller(
  questionMode:
    | "book_meaning_choice"
    | "canonical_definition_to_headword"
    | "canonical_example_to_headword",
) {
  return {
    actions: {
      changeDirection: vi.fn(),
      changeOrder: vi.fn(),
      changePassingScore: vi.fn(),
      changeRetryEnabled: vi.fn(),
      changeRetryPassingScore: vi.fn(),
    },
    state: {
      draft: {
        questionMode,
        exam: {
          directionRatio: questionMode === "book_meaning_choice" ? 50 : 0,
          questionOrderMode: "ascending",
          passingScore: 80,
          retryEnabled: false,
          timing: { mode: "total", totalSeconds: 300 },
        },
      },
    },
  } as never;
}

describe("BulkExamFields", () => {
  it("세 출제 자료 탭을 표시하고 선택 변경을 전달한다", () => {
    const onQuestionModeChange = vi.fn();
    render(
      <BulkExamFields
        controller={controller("book_meaning_choice")}
        onQuestionModeChange={onQuestionModeChange}
      />,
    );

    expect(screen.getAllByRole("tab")).toHaveLength(3);
    fireEvent.click(screen.getByRole("tab", { name: "예문 → 영어" }));
    expect(onQuestionModeChange).toHaveBeenCalledWith(
      "canonical_example_to_headword",
    );
  });

  it("영영풀이·예문 유형에서는 기존 시험 방식 버튼을 잠근다", () => {
    render(
      <BulkExamFields
        controller={controller("canonical_definition_to_headword")}
        onQuestionModeChange={vi.fn()}
      />,
    );

    for (const name of ["영어 → 뜻", "뜻 → 영어", "혼합"]) {
      expect(screen.getByRole("button", { name })).toBeDisabled();
    }
    expect(screen.getByRole("status")).toHaveTextContent("Preview 전용");
  });
});
