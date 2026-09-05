// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { BulkExamFields } from "./bulk-exam-fields";
import { assignmentQuestionModes } from "../domain/model";

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
        availableQuestionModes={[
          "book_meaning_choice",
          "canonical_definition_to_headword",
          "canonical_example_to_headword",
        ]}
        controller={controller("book_meaning_choice")}
        datasetSelected
        onQuestionModeChange={onQuestionModeChange}
      />,
    );

    expect(screen.getAllByRole("tab")).toHaveLength(3);
    fireEvent.click(screen.getByRole("tab", { name: "예문 → 영어" }));
    expect(onQuestionModeChange).toHaveBeenCalledWith(
      "canonical_example_to_headword",
    );
  });

  it("배정 가능한 문항이 없는 유형만 잠그고 검토 진행으로 오해시키지 않는다", () => {
    const onQuestionModeChange = vi.fn();
    render(
      <BulkExamFields
        availableQuestionModes={[
          "book_meaning_choice",
          "canonical_definition_to_headword",
        ]}
        controller={controller("book_meaning_choice")}
        datasetSelected
        onQuestionModeChange={onQuestionModeChange}
      />,
    );

    const exampleTab = screen.getByRole("tab", {
      name: "예문 → 영어",
    });
    expect(exampleTab).toBeDisabled();
    expect(exampleTab).toHaveAttribute(
      "aria-describedby",
      "example-mode-unavailable",
    );
    expect(screen.getByText(/배정 가능한 예문 문항이 없습니다/)).toBeVisible();
    expect(screen.queryByText(/검토 중/)).not.toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "영영풀이 → 영어" })).toBeEnabled();
    fireEvent.click(exampleTab);
    expect(onQuestionModeChange).not.toHaveBeenCalled();
  });

  it("영영풀이·예문 유형에서는 기존 시험 방식 버튼을 잠근다", () => {
    render(
      <BulkExamFields
        availableQuestionModes={assignmentQuestionModes}
        controller={controller("canonical_definition_to_headword")}
        datasetSelected
        onQuestionModeChange={vi.fn()}
      />,
    );

    for (const name of ["영어 → 뜻", "뜻 → 영어", "혼합"]) {
      expect(screen.getByRole("button", { name })).toBeDisabled();
    }
    expect(screen.getByRole("status")).toHaveTextContent("영어 선택지 4개");
    expect(screen.getByRole("status")).toHaveTextContent("시험일 없이 1회 배정");
    expect(screen.queryByText(/Preview 전용/)).not.toBeInTheDocument();
  });

  it("단어장 미선택은 검토 중이나 문항 없음이 아니라 선택 안내를 표시한다", () => {
    const onQuestionModeChange = vi.fn();
    render(<BulkExamFields
      availableQuestionModes={assignmentQuestionModes}
      controller={controller("book_meaning_choice")}
      datasetSelected={false}
      onQuestionModeChange={onQuestionModeChange}
    />);
    expect(screen.getByText(/단어장을 먼저 선택하면/)).toBeVisible();
    for (const name of ["영영풀이 → 영어", "예문 → 영어"]) {
      const tab = screen.getByRole("tab", { name });
      expect(tab).toBeDisabled();
      expect(tab).toHaveAttribute("aria-describedby", "question-mode-dataset-required");
      fireEvent.click(tab);
    }
    expect(onQuestionModeChange).not.toHaveBeenCalled();
    expect(screen.queryByText(/검토 중|문항이 없습니다/)).not.toBeInTheDocument();
  });

  it("유형 정보 누락을 문항 0개로 바꾸지 않고 재확인 방법을 알린다", () => {
    const { rerender } = render(<BulkExamFields
      controller={controller("book_meaning_choice")}
      datasetSelected
      onQuestionModeChange={vi.fn()}
    />);
    expect(screen.getByRole("alert")).toHaveTextContent("출제 유형 정보를 확인하지 못했습니다");
    expect(screen.getByRole("tab", { name: "예문 → 영어" })).toHaveAttribute(
      "aria-describedby", "question-mode-status-unavailable",
    );
    expect(screen.queryByText(/문항이 없습니다|검토 중/)).not.toBeInTheDocument();
    rerender(<BulkExamFields
      availableQuestionModes={assignmentQuestionModes}
      controller={controller("book_meaning_choice")}
      datasetSelected
      onQuestionModeChange={vi.fn()}
    />);
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "예문 → 영어" })).toBeEnabled();
  });
});
