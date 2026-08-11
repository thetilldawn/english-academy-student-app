/** @vitest-environment jsdom */

import "@testing-library/jest-dom/vitest";

import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import type {
  AttemptResultQuestion,
  StudentAttemptResult,
} from "../model";
import { StudentResultView } from "./student-result-view";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: vi.fn() }),
}));

afterEach(cleanup);

function question(
  id: string,
  overrides: Partial<AttemptResultQuestion> = {},
): AttemptResultQuestion {
  return {
    id,
    orderIndex: Number(id.replace(/\D/g, "")) || 1,
    direction: "english_to_korean",
    prompt: `prompt-${id}`,
    correctAnswer: `answer-${id}`,
    correctChoiceIndex: 2,
    initialChoice: `wrong-${id}`,
    initialIsCorrect: false,
    retryChoice: null,
    retryIsCorrect: null,
    wrongCount: 1,
    headword: `word-${id}`,
    primaryMeaning: `meaning-${id}`,
    provenanceStatus: "verified_v2",
    ...overrides,
  };
}

function result(
  questions: AttemptResultQuestion[],
  overrides: Partial<StudentAttemptResult> = {},
): StudentAttemptResult {
  return {
    id: "attempt-1",
    title: "DAY 01 단어 시험",
    status: "completed",
    phase: "completed",
    attemptNumber: 1,
    questionCount: questions.length,
    initialCorrectCount: 0,
    retryCorrectCount: 0,
    unresolvedWrongCount: questions.length,
    initialScore: 0,
    finalScore: 0,
    passed: false,
    elapsedSeconds: 60,
    startedAt: "2026-08-11T00:00:00.000Z",
    initialCompletedAt: "2026-08-11T00:01:00.000Z",
    completedAt: "2026-08-11T00:01:00.000Z",
    questions,
    ...overrides,
  };
}

describe("StudentResultView", () => {
  it("shows only the correct answer and colors the left bar by wrong count", () => {
    const questions = [
      question("q1", { wrongCount: 1 }),
      question("q2", { wrongCount: 2 }),
    ];
    const { container } = render(<StudentResultView result={result(questions)} />);

    const cards = container.querySelectorAll("article[data-wrong-level]");
    expect(cards).toHaveLength(2);
    expect(cards[0]).toHaveAttribute("data-wrong-level", "1");
    expect(cards[1]).toHaveAttribute("data-wrong-level", "2");

    for (const [index, card] of [...cards].entries()) {
      expect(within(card as HTMLElement).getByText(`meaning-q${index + 1}`)).toBeVisible();
      expect(within(card as HTMLElement).queryByText(`wrong-q${index + 1}`)).not.toBeInTheDocument();
      expect(within(card as HTMLElement).queryByText("첫 선택")).not.toBeInTheDocument();
      expect(within(card as HTMLElement).queryByText("재시험")).not.toBeInTheDocument();
    }
  });

  it("separates resolved words without duplicating them in the unresolved section", () => {
    render(
      <StudentResultView
        result={
          result([
            question("q1"),
            question("q2", {
              retryChoice: "meaning-q2",
              retryIsCorrect: true,
            }),
          ], {
            retryCorrectCount: 1,
            unresolvedWrongCount: 1,
          })
        }
      />,
    );

    const unresolved = screen.getByRole("heading", { name: "다시 볼 단어" }).closest("section");
    const resolved = screen.getByRole("heading", { name: "해결한 단어" }).closest("section");
    expect(unresolved).not.toBeNull();
    expect(resolved).not.toBeNull();
    expect(within(unresolved as HTMLElement).getByText("word-q1")).toBeVisible();
    expect(within(unresolved as HTMLElement).queryByText("word-q2")).not.toBeInTheDocument();
    expect(within(resolved as HTMLElement).getByText("word-q2")).toBeVisible();
  });

  it("shows the retry action only while the first result waits for review", () => {
    const { rerender } = render(
      <StudentResultView
        result={
          result([question("q1")], {
            status: "in_progress",
            phase: "review",
            completedAt: null,
          })
        }
      />,
    );
    expect(screen.getByRole("button", { name: "재시험 시작" })).toBeVisible();

    rerender(<StudentResultView result={result([question("q1")])} />);
    expect(screen.queryByRole("button", { name: "재시험 시작" })).not.toBeInTheDocument();
  });

  it("uses the final score and retry outcome after a retry is completed", () => {
    render(
      <StudentResultView
        result={
          result(
            [
              question("q1", {
                retryChoice: "meaning-q1",
                retryIsCorrect: true,
              }),
            ],
            {
              initialScore: 25,
              finalScore: 100,
              initialCorrectCount: 1,
              retryCorrectCount: 1,
              unresolvedWrongCount: 0,
              passed: false,
            },
          )
        }
      />,
    );

    const header = screen.getByRole("heading", { name: "DAY 01 단어 시험" }).closest("header");
    expect(header).not.toBeNull();
    expect(within(header as HTMLElement).getByText("100점")).toBeVisible();
    expect(
      within(header as HTMLElement).getByText(
        "재시험에서 틀린 단어를 모두 해결했습니다.",
      ),
    ).toBeVisible();
    expect(
      within(header as HTMLElement).queryByText("통과점수에는 미치지 못했습니다."),
    ).not.toBeInTheDocument();
  });
});
