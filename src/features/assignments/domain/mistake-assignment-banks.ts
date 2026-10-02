type Question = { direction: "english_to_korean" | "korean_to_english"; prompt: string; choices: string[]; correctChoiceIndex: number };
export type MistakeBankItem = {
  word: { meaningKey: string; wordKey: string; latestVocabEntryId: number; frozenQuestion: Question & { quizContentMode: string } };
  generated: Question | null;
};
const normalize = (value: string) => value.normalize("NFKC").trim().toLowerCase();
const question = (item: MistakeBankItem) => item.generated ?? item.word.frozenQuestion;
function conflict(a: MistakeBankItem, b: MistakeBankItem) {
  if (a.word.latestVocabEntryId === b.word.latestVocabEntryId || a.word.wordKey === b.word.wordKey) return true;
  const x = question(a), y = question(b);
  return x.direction === y.direction && normalize(x.prompt) === normalize(y.prompt) &&
    normalize(x.choices[x.correctChoiceIndex]) !== normalize(y.choices[y.correctChoiceIndex]);
}
function ratio(items: MistakeBankItem[]): 0 | 50 | 100 | null {
  const count = items.filter(item => question(item).direction === "english_to_korean").length;
  return count === 0 ? 0 : count === items.length ? 100 : count === Math.round(items.length / 2) ? 50 : null;
}

/** Split only when a bank would lose a meaning or mix incompatible question
 * types. Total test time is shared across the resulting banks, never doubled. */
export function splitMistakeAssignmentBanks<T extends MistakeBankItem>(items: T[], totalSeconds: number | null) {
  const grouped: T[][] = [];
  for (const item of items) {
    const bank = grouped.find(values => values.length < 500 && values[0].word.frozenQuestion.quizContentMode === item.word.frozenQuestion.quizContentMode &&
      values.every(other => !conflict(item, other)));
    if (bank) bank.push(item); else grouped.push([item]);
  }
  const groups = grouped.flatMap(values => ratio(values) === null ? [
    values.filter(item => question(item).direction === "english_to_korean"),
    values.filter(item => question(item).direction === "korean_to_english"),
  ].filter(values => values.length) : [values]);
  if (totalSeconds !== null && totalSeconds < groups.length * 30) return {
    banks: [], error: `뜻과 문제 종류를 보존하려면 시험 ${groups.length}개가 필요합니다. 전체 시간을 ${groups.length * 30}초 이상으로 늘리거나 시간 제한을 바꿔 주세요.`,
  };
  const remaining = totalSeconds === null ? 0 : totalSeconds - groups.length * 30;
  const portions = groups.map(values => remaining * values.length / items.length);
  const seconds = portions.map(value => 30 + Math.floor(value));
  let rest = totalSeconds === null ? 0 : totalSeconds - seconds.reduce((sum, value) => sum + value, 0);
  const order = portions.map((value, index) => ({ index, fraction: value % 1 })).sort((a, b) => b.fraction - a.fraction || a.index - b.index);
  for (const item of order) if (rest-- > 0) seconds[item.index]++;
  return { banks: groups.map((values, index) => ({ index, items: values, questionCount: values.length,
    quizContentMode: values[0].word.frozenQuestion.quizContentMode, englishToKoreanRatio: ratio(values)!,
    timeLimitSeconds: totalSeconds === null ? null : seconds[index] })), error: null };
}
