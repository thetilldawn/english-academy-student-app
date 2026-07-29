import { describe, expect, it } from "vitest";

import {
  createStudentSchema,
  updateStudentVocabSchema,
} from "@/lib/validation";

describe("학생 정보 입력 계약", () => {
  const datasetId = "11111111-1111-4111-8111-111111111111";

  it("학생 이름만 필수이고 단어장과 나머지는 선택 사항으로 둔다", () => {
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

  it("단어장 없이도 학생을 만들 수 있게 null로 정규화한다", () => {
    expect(
      createStudentSchema.parse({
        displayName: "테스트 학생",
      }),
    ).toEqual({
      displayName: "테스트 학생",
      schoolName: "",
      gradeLabel: "",
      currentVocabDatasetId: null,
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

  it("임의 단어장 문자열 입력은 거절한다", () => {
    expect(() =>
      createStudentSchema.parse({
        displayName: "테스트 학생",
        currentVocabDatasetId: "능률 VOCA 어원편",
      }),
    ).toThrow();
  });

  it("현재 단어장은 검수 데이터셋 ID 또는 미선택만 받는다", () => {
    expect(
      updateStudentVocabSchema.parse({
        currentVocabDatasetId: datasetId,
      }),
    ).toEqual({ currentVocabDatasetId: datasetId });
    expect(
      updateStudentVocabSchema.parse({
        currentVocabDatasetId: "",
      }),
    ).toEqual({ currentVocabDatasetId: null });
    expect(() =>
      updateStudentVocabSchema.parse({
        currentVocabDatasetId: "직접 입력 단어장",
      }),
    ).toThrow();
  });
});
