import { z } from "zod";
import { quizContentModes } from "@/lib/quiz/question-content-mode";
import { reviewedChoiceSafetySchema } from "@/lib/quiz/choice-safety";
import { buildDirectionalQuestionSets, quizIndependentTargetDirectionEligibility } from "@/lib/quiz/choice-policy";
import { createTargetedQuizQuestions } from "@/lib/quiz/question-generator";
import { shuffle } from "@/lib/quiz/random";
import { practiceMistakeEpisodeIdSchema, practiceSettingsSchema, type PracticeSettings } from "../contracts/practice";
import { practiceSourceSchema, seededRandom, type PracticeEntry } from "./practice-plan";

const direction = z.enum(["english_to_korean", "korean_to_english"]);
export const mistakePracticeSourceSchema = z.object({
  sourceHash: z.string().regex(/^[a-f0-9]{64}$/),
  candidates: practiceSourceSchema.shape.candidates,
  words: z.array(z.object({
    key: z.string().regex(/^[a-f0-9]{64}$/), wordKey: z.string().min(1), meaningKey: z.string().regex(/^[a-f0-9]{64}$/), episodeId: practiceMistakeEpisodeIdSchema,
    headword: z.string(), primaryMeaning: z.string(), selectedText: z.string(), testedField: z.enum(["primary_meaning", "definition", "example"]),
    latestVocabEntryId: z.number().int().positive(), choiceSafety: reviewedChoiceSafetySchema.nullable(), frozenOnly: z.boolean(),
    sourceQuestionId: z.uuid(), sourceAttemptId: z.uuid(), sourcePhase: z.enum(["initial", "retry"]), sourceContentHash: z.string().regex(/^[a-f0-9]{64}$/),
    frozenQuestion: z.object({ quizContentMode: z.enum(quizContentModes), direction, prompt: z.string(), choices: z.array(z.string()).length(4), correctChoiceIndex: z.number().int().min(0).max(3) }),
  }).passthrough()).max(10000),
});
export type MistakePracticeSource = z.infer<typeof mistakePracticeSourceSchema>;
export type MistakePracticeWord = MistakePracticeSource["words"][number];

/** A card may contain multiple meanings. Their question IDs are distinct; the
 * normal ambiguity checks still apply to the shared headword and each option. */
export function buildMistakePracticePlan(source: MistakePracticeSource, settings: PracticeSettings, seed: string,
  options: { separateBanks?: boolean; exactEnglishCount?: number } = {}) {
  practiceSettingsSchema.parse(settings);
  const englishCount = options.exactEnglishCount ?? Math.round(settings.questionCount * settings.englishToKoreanRatio / 100);
  if (!Number.isInteger(englishCount) || englishCount < 0 || englishCount > settings.questionCount) {
    throw new Error("출제 방향별 문항 수를 확인해 주세요.");
  }
  const random = seededRandom(seed), excluded: { key: string; headword: string; reason: string }[] = [];
  let id = 0;
  const candidates: PracticeEntry[] = source.candidates.map(value => ({ id: ++id, entryId: value.entryId, headword: value.headword,
    primaryMeaning: value.primaryMeaning, eligibleDirections: value.eligibleDirections, ...(value.choiceSafety ? { choiceSafety: value.choiceSafety } : {}) }));
  const entries = new Map<string, PracticeEntry>();
  for (const word of source.words.filter(value => value.testedField === "primary_meaning" && !value.frozenOnly)) {
    const current = source.candidates.find(value => value.entryId === word.latestVocabEntryId && value.headword === word.headword);
    if (!current?.eligibleDirections.length || current.primaryMeaning !== word.selectedText ||
      word.choiceSafety && (word.choiceSafety.target.headword !== word.headword || word.choiceSafety.target.primaryMeaning !== word.selectedText)) continue;
    const entry: PracticeEntry = { id: ++id, entryId: word.latestVocabEntryId, key: word.key, raw: word,
      headword: word.headword, primaryMeaning: word.selectedText, canonicalKey: word.wordKey, eligibleDirections: current.eligibleDirections,
      ...(word.choiceSafety ? { choiceSafety: word.choiceSafety } : {}) };
    entries.set(word.key, entry); candidates.push(entry);
  }
  // Different meanings of one word can be assigned to separate banks. Judge
  // their possible directions individually before the final bank validation.
  const independent = options.separateBanks ? quizIndependentTargetDirectionEligibility([...entries.values()], candidates) : null;
  const allowed = independent ? {
    englishCandidateIds: new Set(independent.filter(value => value.eligibleDirections.includes("english_to_korean")).map(value => value.id)),
    koreanCandidateIds: new Set(independent.filter(value => value.eligibleDirections.includes("korean_to_english")).map(value => value.id)),
  } : buildDirectionalQuestionSets([...entries.values()], candidates);
  const directionOptions = source.words.map(word => {
    const entry = entries.get(word.key);
    const english = !!entry && allowed.englishCandidateIds.has(entry.id) || word.frozenQuestion.direction === "english_to_korean";
    const korean = !!entry && allowed.koreanCandidateIds.has(entry.id) || word.frozenQuestion.direction === "korean_to_english";
    return { word, english, korean };
  });
  const valid = directionOptions.filter(({ word, english, korean }) => {
    if (!(englishCount === settings.questionCount ? english : englishCount === 0 ? korean : english || korean)) {
      if (!excluded.some(value => value.key === word.key)) excluded.push({ key: word.key, headword: word.headword,
        reason: word.testedField === "primary_meaning" ? "이 방향의 서로 다른 보기가 부족합니다." : "영영풀이와 예문은 원래 문제 방향을 유지합니다." });
      return false;
    }
    return true;
  });
  const ordered = shuffle(valid, random);
  const english = ordered.filter(value => value.english && !value.korean).slice(0, englishCount);
  const korean = ordered.filter(value => value.korean && !value.english).slice(0, settings.questionCount - englishCount);
  const both = ordered.filter(value => value.english && value.korean);
  english.push(...both.splice(0, englishCount - english.length));
  korean.push(...both.splice(0, settings.questionCount - englishCount - korean.length));
  const selected = shuffle([...english.map(value => ({ ...value, direction: "english_to_korean" as const })),
    ...korean.map(value => ({ ...value, direction: "korean_to_english" as const }))], random);
  let error = selected.length !== settings.questionCount ? "문항 수나 출제 방향을 조정해 주세요. 원문 재사용 문제는 원래 방향으로 연습합니다." : null;
  const items = error ? [] : selected.map(({ word, direction }) => {
    const entry = entries.get(word.key);
    const generated = entry && (direction === "english_to_korean" ? allowed.englishCandidateIds : allowed.koreanCandidateIds).has(entry.id)
      ? createTargetedQuizQuestions([entry], candidates, direction === "english_to_korean" ? 100 : 0, random, { allowRepeatedVocabularyIdentity: true })[0] : null;
    return { word, generated };
  });
  const normalize = (text: string) => text.normalize("NFKC").trim().toLowerCase();
  if (!options.separateBanks && items.some((item, at) => items.slice(at + 1).some(other => {
    const a = item.generated ?? item.word.frozenQuestion, b = other.generated ?? other.word.frozenQuestion;
    const answerA = normalize(a.choices[a.correctChoiceIndex]), answerB = normalize(b.choices[b.correctChoiceIndex]);
    return item.word.frozenQuestion.quizContentMode === other.word.frozenQuestion.quizContentMode && a.direction === b.direction &&
      normalize(a.prompt) === normalize(b.prompt) && answerA !== answerB &&
      (a.choices.some(text => normalize(text) === answerB) || b.choices.some(text => normalize(text) === answerA));
  }))) error = "같은 질문에 다른 정답이 겹칩니다. 뜻을 나누어 선택하거나 출제 방향을 바꿔 주세요.";
  return { candidates, items: error ? [] : items, selected: selected.map(value => value.word), directionOptions,
    availableCount: valid.length, totalCount: source.words.length, excluded, error };
}
