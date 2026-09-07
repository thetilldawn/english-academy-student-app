import { describe, expect, it } from "vitest";
import { questionSemantics } from "./question-semantics";
import { normalizeQuizContentMode } from "./question-content-mode";

describe("문제와 선택지의 의미 역할", () => {
  it.each([
    ["book_meaning_choice", "english_to_korean", "headword", "korean_meaning"],
    ["book_meaning_choice", "korean_to_english", "korean_meaning", "headword"],
    ["canonical_definition_to_headword", "korean_to_english", "english_definition", "headword"],
    ["canonical_headword_to_definition", "english_to_korean", "headword", "english_definition"],
    ["canonical_example_to_headword", "korean_to_english", "english_example", "headword"],
  ] as const)("%s %s", (mode, direction, prompt, choice) => {
    expect(questionSemantics(mode, direction)).toEqual({ prompt, choice });
  });
  it("언어가 같아도 뒤집힌 계약은 거부한다", () => {
    expect(() => questionSemantics("canonical_headword_to_definition", "korean_to_english")).toThrow("방향");
    expect(() => questionSemantics("canonical_definition_to_headword", "english_to_korean")).toThrow("방향");
    expect(() => questionSemantics("canonical_example_to_headword", "english_to_korean")).toThrow("방향");
  });
  it("구형 뜻 모드와 새 모드를 명시적으로 읽는다", () => {
    expect(normalizeQuizContentMode("legacy_book_meaning_choice")).toBe("book_meaning_choice");
    expect(normalizeQuizContentMode("canonical_headword_to_definition")).toBe("canonical_headword_to_definition");
    expect(() => normalizeQuizContentMode("guess")).toThrow();
  });
});
