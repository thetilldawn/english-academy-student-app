import { describe, expect, it } from "vitest";

import { createStudentSchema } from "@/lib/validation";

describe("학생 정보 입력 계약", () => {
  it("학생 이름만 필수이고 나머지는 빈 문자열을 기본값으로 둔다", () => {
    expect(
      createStudentSchema.parse({ displayName: "  테스트 학생  " }),
    ).toEqual({
      displayName: "테스트 학생",
      schoolName: "",
      gradeLabel: "",
      currentVocabBook: "",
      note: "",
    });
  });

  it("공백뿐인 학생 이름은 거절한다", () => {
    expect(() =>
      createStudentSchema.parse({ displayName: "   " }),
    ).toThrow();
  });

  it("현재 단어장 이름을 다듬고 160자로 제한한다", () => {
    const accepted = createStudentSchema.parse({
      displayName: "테스트 학생",
      currentVocabBook: `  ${"A".repeat(160)}  `,
    });

    expect(accepted.currentVocabBook).toHaveLength(160);
    expect(() =>
      createStudentSchema.parse({
        displayName: "테스트 학생",
        currentVocabBook: "A".repeat(161),
      }),
    ).toThrow();
  });
});
