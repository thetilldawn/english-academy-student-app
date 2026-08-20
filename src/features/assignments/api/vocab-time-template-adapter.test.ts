import { describe, expect, it } from "vitest";

import {
  buildVocabTimeTemplateRequest,
  parseCreatedVocabTimeTemplate,
} from "./vocab-time-template-adapter";

const id = "00000000-0000-4000-8000-000000000111";

describe("시간 템플릿 API 변환", () => {
  it("문제당 제한시간 템플릿을 요청과 화면 모델로 변환한다", () => {
    expect(buildVocabTimeTemplateRequest({
      name: "저녁 수업",
      availableTime: "18:00",
      deadlineDayOffset: 1,
      deadlineTime: "22:00",
      timing: { mode: "per_question", perQuestionSeconds: 15 },
    })).toMatchObject({
      timingMode: "per_question",
      totalSeconds: null,
      perQuestionSeconds: 15,
    });

    expect(parseCreatedVocabTimeTemplate({
      template: {
        id,
        name: "저녁 수업",
        availableTime: "18:00",
        deadlineDayOffset: 1,
        deadlineTime: "22:00",
        timingMode: "per_question",
        totalSeconds: null,
        perQuestionSeconds: 15,
      },
    })).toMatchObject({
      id,
      label: "저녁 수업",
      timing: { mode: "per_question", perQuestionSeconds: 15 },
    });
  });

  it("서버가 모순된 제한시간 조합을 보내면 기본값으로 덮지 않고 실패한다", () => {
    expect(() => parseCreatedVocabTimeTemplate({
      template: {
        id,
        name: "잘못된 값",
        availableTime: "18:00",
        deadlineDayOffset: 1,
        deadlineTime: "22:00",
        timingMode: "total",
        totalSeconds: null,
        perQuestionSeconds: 15,
      },
    })).toThrow();
  });
});
