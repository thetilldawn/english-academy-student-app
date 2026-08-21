import { describe, expect, it } from "vitest";

import type { AttemptResultQuestion } from "../model";
import { selectResultQuestionGroups } from "./result-question-groups";

const question = {
  id: "question-1",
  initialIsCorrect: null,
  retryIsCorrect: null,
  wrongCount: 0,
} as AttemptResultQuestion;

describe("selectResultQuestionGroups", () => {
  it("treats a legacy unanswered expired question as unresolved", () => {
    const groups = selectResultQuestionGroups({
      questions: [question],
      status: "expired",
    });

    expect(groups.wrong).toHaveLength(1);
    expect(groups.unresolved[0]).toMatchObject({
      initialIsCorrect: false,
      wrongCount: 1,
    });
    expect(groups.resolved).toEqual([]);
    expect(question).toMatchObject({ initialIsCorrect: null, wrongCount: 0 });
  });

  it("does not call an unanswered in-progress question wrong", () => {
    expect(
      selectResultQuestionGroups({
        questions: [question],
        status: "in_progress",
      }).wrong,
    ).toEqual([]);
  });
});
