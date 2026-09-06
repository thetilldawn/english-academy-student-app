import { describe, expect, it } from "vitest";
import { rangeFromStudyPrompt, splitStudyExample, studyExampleRanges } from "./study-example-ranges";

describe("승인 빈칸과 완성 원문의 학습 가리기 위치", () => {
  it.each([
    ["She collected the letters.", "She _____ the letters.", "collect", "collected"],
    ["He went home.", "He _____ home.", "go", "went"],
    ["They looked after him.", "They _____ him.", "look after", "looked after"],
    ["She  collected\n the letters.", "She _____ the letters.", "collect", "collected"],
    ["It is (a+b), indeed.", "It is (_____), indeed.", "a+b", "a+b"],
  ])("원문 변형 없이 %s의 대상만 찾는다", (example, prompt, headword, target) => {
    const ranges = studyExampleRanges(example, headword, [prompt]);
    const parts = splitStudyExample(example, ranges)!;
    expect(parts.filter((part) => part.concealed).map((part) => part.text)).toEqual([target]);
    expect(parts.map((part) => part.text).join("")).toBe(example);
  });
  it("같은 표면형과 표제어 반복만 가리며 유사 철자·복합어를 건드리지 않는다", () => {
    const example = "Ill people will feel ill, not illness or ill-advised.";
    const ranges = studyExampleRanges(example, "ill", ["_____ people will feel ill, not illness or ill-advised."]);
    expect(splitStudyExample(example, ranges)?.filter((part) => part.concealed).map((part) => part.text)).toEqual(["Ill", "ill"]);
  });
  it("동일 위치 중복은 허용하고 서로 다른 빈칸 후보는 추측하지 않는다", () => {
    expect(studyExampleRanges("Go and go.", "go", ["_____ and go.", "_____ and go."])).toHaveLength(2);
    expect(studyExampleRanges("Go and go.", "go", ["_____ and go.", "Go and _____."])).toBeNull();
  });
  it.each(["She collected them.", "She _____ _____ letters.", "He _____ the letters.", "She _ the letters."])("지원하지 않는 빈칸이나 불일치 %s는 실패한다", (prompt) => {
    expect(rangeFromStudyPrompt("She collected the letters.", prompt)).toBeNull();
  });
  it("입력이 없거나 너무 길거나 빈칸에 실제 단어가 없으면 추측하지 않는다", () => {
    expect(studyExampleRanges("She collected them.", "collect", [])).toBeNull();
    expect(rangeFromStudyPrompt("a".repeat(10_001), "_____")).toBeNull();
    expect(rangeFromStudyPrompt("She   them.", "She _____ them.")).toBeNull();
  });
  it.each([null, [], [{ start: -1, end: 2 }], [{ start: 0.5, end: 2 }], [{ start: 0, end: 100 }], [{ start: 3, end: 3 }], [{ start: 2, end: 4 }, { start: 1, end: 3 }]])("유효하지 않은 좌표는 부분 원문을 만들지 않는다", (ranges) => {
    expect(splitStudyExample("example", ranges)).toBeNull();
  });
});
