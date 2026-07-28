import { describe, expect, it } from "vitest";

import { createStudentSchema } from "@/lib/validation";

describe("학생 정보 입력 계약", () => {
  const datasetId = "11111111-1111-4111-8111-111111111111";

  it("학생 이름과 단어장 선택은 필수이고 나머지는 빈 문자열을 기본값으로 둔다", () => {
    expect(
      createStudentSchema.parse({
        displayName: "  테스트 학생  ",
        currentVocabDatasetId: datasetId,
      }),
    ).toEqual({
      displayName: "테스트 학생",
      schoolName: "",
      gradeLabel: "",
      currentVocabDatasetId: datasetId,
      note: "",
    });
  });

  it("공백뿐인 학생 이름은 거절한다", () => {
    expect(() =>
      createStudentSchema.parse({
        displayName: "   ",
        currentVocabDatasetId: datasetId,
      }),
    ).toThrow();
  });

  it("단어장 ID 누락과 임의 문자열 입력을 거절한다", () => {
    expect(() =>
      createStudentSchema.parse({
        displayName: "테스트 학생",
      }),
    ).toThrow();
    expect(() =>
      createStudentSchema.parse({
        displayName: "테스트 학생",
        currentVocabDatasetId: "능률 VOCA 어원편",
      }),
    ).toThrow();
  });
});
