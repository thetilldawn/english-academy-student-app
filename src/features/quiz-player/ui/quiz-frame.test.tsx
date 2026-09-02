// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";

import { createRef } from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { studentAppText } from "@/content/ko/student-app";

import type { QuizQuestion } from "../model";
import { QuizFrame } from "./quiz-frame";

const availablePronunciation = {
  audioUrl: "https://example.com/audio.mp3",
  available: true,
  displayKo: "발음",
  segments: [
    { text: "발", stress: "primary" },
    { text: "음", stress: "none" },
  ],
  variantId: "test:1",
} as const;

function question(
  direction: QuizQuestion["direction"],
): QuizQuestion {
  return {
    choicePronunciations: Array.from(
      { length: 4 },
      () => availablePronunciation,
    ),
    choices:
      direction === "english_to_korean"
        ? ["뜻 하나", "뜻 둘", "뜻 셋", "뜻 넷"]
        : ["alpha", "beta", "gamma", "delta"],
    direction,
    id: "question-1",
    initialChoiceIndex: null,
    initialIsCorrect: null,
    initialTimedOut: false,
    orderIndex: 1,
    priorWrongLevel: 0,
    prompt: direction === "english_to_korean" ? "outstanding" : "뛰어난",
    pronunciation: availablePronunciation,
    retryChoiceIndex: null,
    retryIsCorrect: null,
    retryTimedOut: false,
    revealedCorrectChoiceIndex: null,
  };
}

function renderFrame(
  currentQuestion: QuizQuestion,
  overrides: Partial<Parameters<typeof QuizFrame>[0]> = {},
) {
  const onChoose = vi.fn();
  const onPlayAudio = vi.fn();
  render(
    <QuizFrame
      answerAnnouncement=""
      assignmentTitle="Vocabulary quiz"
      choiceDensity="default"
      choiceFeedback={() => null}
      completedInPhase={0}
      currentQuestion={currentQuestion}
      error=""
      formattedRemaining="0:10"
      onChoose={onChoose}
      onPlayAudio={onPlayAudio}
      onRetrySynchronization={vi.fn()}
      phase="initial"
      phaseQuestionCount={4}
      priorWrongIndicator={null}
      progress={0}
      promptAudioUrl={
        currentQuestion.direction === "english_to_korean"
          ? availablePronunciation.audioUrl
          : null
      }
      promptDensity="default"
      promptRef={createRef<HTMLHeadingElement>()}
      quizContentMode="book_meaning_choice"
      remainingSeconds={10}
      submitting={false}
      timerSynchronized
      timeWarning=""
      timedOut={false}
      timingMode="per_question"
      {...overrides}
    />,
  );
  return { onChoose, onPlayAudio };
}

afterEach(cleanup);

describe("QuizFrame", () => {
  it("영영풀이 문제는 영어로 표시하되 정답 단어 발음은 문제 아래 노출하지 않는다", () => {
    const current = question("korean_to_english");
    current.prompt = "A person who watches an event carefully.";
    renderFrame(current, {
      quizContentMode: "canonical_definition_to_headword",
      promptAudioUrl: null,
    });

    const prompt = screen.getByRole("heading", { level: 1 });
    expect(prompt).toHaveTextContent(current.prompt);
    expect(prompt).not.toHaveTextContent("발음");
    expect(screen.getByText(studentAppText.attempt.chooseEnglish)).toBeInTheDocument();
  });

  it("shows one prompt speaker and no Korean-choice speaker", () => {
    renderFrame(question("english_to_korean"));

    expect(
      screen.getAllByRole("button").filter((button) =>
        button.getAttribute("aria-label")?.includes("outstanding"),
      ),
    ).toHaveLength(1);
    expect(screen.getByText("발", { selector: "strong" })).toBeVisible();
    expect(
      document.querySelector("[data-pronunciation-text]"),
    ).toHaveTextContent("[발음]");
    for (const meaning of ["뜻 하나", "뜻 둘", "뜻 셋", "뜻 넷"]) {
      expect(screen.getByRole("button", { name: new RegExp(meaning) })).toBeVisible();
    }
  });

  it("굵게 승인된 구동사 강세 구간을 모두 표시한다", () => {
    const currentQuestion = question("english_to_korean");
    currentQuestion.prompt = "apply for";
    currentQuestion.pronunciation = {
      ...availablePronunciation,
      displayKo: "어플라이 포어",
      segments: [
        { text: "어플", stress: "none" },
        { text: "라이 ", stress: "primary" },
        { text: "포어", stress: "primary" },
      ],
    };
    renderFrame(currentQuestion);

    expect(
      Array.from(document.querySelectorAll("[data-stress='primary']")).map(
        (element) => element.textContent,
      ),
    ).toEqual(["라이 ", "포어"]);
    expect(
      document.querySelector("[data-pronunciation-text]"),
    ).toHaveTextContent("[어플라이 포어]");
  });

  it("1강세와 2강세를 모두 굵게 표시한다", () => {
    const currentQuestion = question("english_to_korean");
    currentQuestion.pronunciation = {
      ...availablePronunciation,
      displayKo: "프라스펙트",
      segments: [
        { text: "프라", stress: "primary" },
        { text: "스펙트", stress: "secondary" },
      ],
    };
    renderFrame(currentQuestion);

    expect(screen.getByText("프라", { selector: "strong" })).toBeVisible();
    expect(screen.getByText("스펙트", { selector: "strong" })).toBeVisible();
  });

  it("shows a speaker beside every English choice and none beside the Korean prompt", () => {
    renderFrame(question("korean_to_english"));

    expect(
      screen.getAllByRole("button").filter((button) =>
        ["alpha", "beta", "gamma", "delta"].some((word) =>
          button.getAttribute("aria-label")?.includes(word),
        ),
      ),
    ).toHaveLength(4);
    expect(
      screen.getAllByRole("button").some((button) =>
        button.getAttribute("aria-label")?.includes("뛰어난"),
      ),
    ).toBe(false);
  });

  it("shows speakers only beside English choices with available audio", () => {
    const currentQuestion = question("korean_to_english");
    currentQuestion.choicePronunciations[1] = {
      audioUrl: null,
      available: false,
      displayKo: null,
      variantId: null,
    };
    renderFrame(currentQuestion);

    expect(
      screen.getByRole("button", { name: /alpha 발음 듣기/ }),
    ).toBeVisible();
    expect(
      screen.queryByRole("button", { name: /beta 발음 듣기/ }),
    ).not.toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /gamma 발음 듣기/ }),
    ).toBeVisible();
    expect(
      screen.getByRole("button", { name: /delta 발음 듣기/ }),
    ).toBeVisible();
  });

  it("shows a full-screen timeout notice without duplicating live narration", () => {
    renderFrame(question("korean_to_english"), {
      answerAnnouncement: studentAppText.attempt.timedOut,
      timedOut: true,
    });

    const overlay = screen.getByTestId("quiz-timeout-overlay");
    expect(overlay).toHaveTextContent(studentAppText.attempt.timeoutTitle);
    expect(overlay).toHaveAttribute("aria-hidden", "true");
    expect(screen.getByText(studentAppText.attempt.timedOut)).toHaveClass(
      "sr-only",
    );
  });

  it("renders no empty audio column when approved audio is unavailable", () => {
    const currentQuestion = question("english_to_korean");
    currentQuestion.pronunciation = {
      audioUrl: null,
      available: false,
      displayKo: null,
      variantId: null,
    };
    renderFrame(currentQuestion, { promptAudioUrl: null });

    expect(
      screen
        .getAllByRole("button")
        .filter((button) => button.querySelector("svg")),
    ).toHaveLength(0);
  });

  it("applies the same longest-choice density to all four answers", () => {
    const currentQuestion = question("korean_to_english");
    currentQuestion.choices[1] = "x".repeat(60);
    renderFrame(currentQuestion, { choiceDensity: "very-long" });

    const answerButtons = screen
      .getByRole("group")
      .querySelectorAll("button:first-child");
    expect(answerButtons).toHaveLength(4);
    for (const button of answerButtons) {
      expect(button.className).toContain("very-long");
    }
  });

  it("handles only valid unmodified number shortcuts inside the frame", () => {
    const { onChoose } = renderFrame(question("english_to_korean"));
    const frame = screen.getByRole("group").closest("section");
    expect(frame).not.toBeNull();

    fireEvent.keyDown(frame!, { key: "3" });
    fireEvent.keyDown(frame!, { ctrlKey: true, key: "2" });
    fireEvent.keyDown(frame!, { key: "8" });

    expect(onChoose).toHaveBeenCalledOnce();
    expect(onChoose).toHaveBeenCalledWith(2);
  });

  it("always renders a nonempty timer string", () => {
    renderFrame(question("english_to_korean"), {
      formattedRemaining: "0:00",
      remainingSeconds: 0,
    });
    expect(screen.getByTestId("quiz-timer")).toHaveTextContent("0:00");
    expect(screen.getByText("문제당")).toBeVisible();
  });

  it("does not label a total timer as per-question", () => {
    renderFrame(question("english_to_korean"), { timingMode: "total" });

    expect(screen.queryByText("문제당")).not.toBeInTheDocument();
  });
});
