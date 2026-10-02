import { describe, expect, it } from "vitest";
import { splitMistakeAssignmentBanks, type MistakeBankItem } from "./mistake-assignment-banks";
function item(id: number, direction: "english_to_korean" | "korean_to_english" = "english_to_korean", mode = "book_meaning_choice"): MistakeBankItem {
  return { word: { meaningKey: `meaning${id}`, wordKey: `word${id}`, latestVocabEntryId: id,
    frozenQuestion: { quizContentMode: mode, direction, prompt: `prompt${id}`, choices: [`answer${id}`, "other1", "other2", "other3"], correctChoiceIndex: 0 } }, generated: null };
}
describe("뜻을 잃지 않는 배정 분할", () => {
  it("같은 entry의 다른 뜻을 각각 한 번 배정하고 전체 시간을 보존한다", () => {
    const a = item(1), b = item(2); b.word.latestVocabEntryId = 1; b.word.wordKey = a.word.wordKey;
    const result = splitMistakeAssignmentBanks([a, b, item(3)], 121);
    expect(result.error).toBeNull(); expect(result.banks.map(bank => bank.questionCount)).toEqual([2, 1]);
    expect(result.banks.flatMap(bank => bank.items.map(item => item.word.meaningKey))).toEqual(["meaning1", "meaning3", "meaning2"]);
    expect(result.banks.reduce((sum, bank) => sum + bank.timeLimitSeconds!, 0)).toBe(121);
  });
  it("3문항 50퍼센트의 반올림을 유지하고 불필요하게 나누지 않는다", () => {
    const result = splitMistakeAssignmentBanks([item(1), item(2), item(3, "korean_to_english")], null);
    expect(result.banks).toHaveLength(1); expect(result.banks[0].englishToKoreanRatio).toBe(50);
  });
  it("다른 문제 종류와 같은 질문의 다른 정답을 나눈다", () => {
    const a = item(1), b = item(2); b.word.frozenQuestion.prompt = a.word.frozenQuestion.prompt;
    expect(splitMistakeAssignmentBanks([a, b, item(3, "korean_to_english", "canonical_example_to_headword")], null).banks).toHaveLength(3);
  });
  it("분할에 필요한 최소 시간보다 부족하면 저장 가능한 결과로 표시하지 않는다", () => {
    const result = splitMistakeAssignmentBanks([item(1), item(2, "korean_to_english", "canonical_example_to_headword")], 30);
    expect(result.banks).toEqual([]); expect(result.error).toContain("60초");
  });
});
