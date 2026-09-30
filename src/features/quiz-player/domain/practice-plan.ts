import { z } from "zod";
import { reviewedChoiceSafetySchema } from "@/lib/quiz/choice-safety";
import { buildDirectionalQuestionSets } from "@/lib/quiz/choice-policy";
import { createTargetedQuizQuestions } from "@/lib/quiz/question-generator";
import { shuffle } from "@/lib/quiz/random";
import type { QuizVocabularyEntry } from "@/lib/quiz/question-types";
import { practiceSettingsSchema, type PracticeSettings } from "../contracts/practice";

const sourceWord = z.object({ key: z.string(), headword: z.string(), primaryMeaning: z.string(), wrongCount: z.number(),
  latestVocabEntryId: z.number().int().positive(), choiceSafety: reviewedChoiceSafetySchema.nullable(),
}).passthrough();
const candidate = z.object({ entryId: z.number().int().positive(), datasetId: z.uuid(), headword: z.string(), primaryMeaning: z.string(), displayKo: z.string().nullable(),
  eligibleDirections: z.array(z.enum(["english_to_korean", "korean_to_english"])), choiceSafety: reviewedChoiceSafetySchema.nullable(),
});
export const practiceSourceSchema = z.object({ sourceHash: z.string().regex(/^[a-f0-9]{64}$/), words: z.array(sourceWord).max(10000), candidates: z.array(candidate).max(20000) });
export type PracticeSource = z.infer<typeof practiceSourceSchema>;
export type PracticeEntry = QuizVocabularyEntry & { entryId: number; key?: string; raw?: PracticeSource["words"][number] };

function seededRandom(seed: string) {
  let state = 2166136261;
  for (const char of seed) state = Math.imul(state ^ char.charCodeAt(0), 16777619);
  return () => { state += 0x6D2B79F5; let value = Math.imul(state ^ state >>> 15, 1 | state); value ^= value + Math.imul(value ^ value >>> 7, 61 | value); return ((value ^ value >>> 14) >>> 0) / 4294967296; };
}

/** Exact historical bodies also enter the candidate pool. The generator resolves
 * target IDs from that pool; a current entry must not replace an old meaning. */
export function buildPracticePlan(source: PracticeSource, settings: PracticeSettings, seed: string) {
  practiceSettingsSchema.parse(settings);
  const random = seededRandom(seed), excluded: { key: string; headword: string; reason: string }[] = [];
  let id = 0;
  const candidates: PracticeEntry[] = source.candidates.map(value => ({ id: ++id, entryId: value.entryId,
    headword: value.headword, primaryMeaning: value.primaryMeaning, eligibleDirections: value.eligibleDirections,
    ...(value.choiceSafety ? { choiceSafety: value.choiceSafety } : {}),
  }));
  const targets: PracticeEntry[] = [];
  for (const word of source.words) {
    const current = source.candidates.find(entry => entry.entryId === word.latestVocabEntryId && entry.headword === word.headword);
    if (!current?.eligibleDirections.length) {
      excluded.push({ key: word.key, headword: word.headword, reason: "검토된 출제 방향을 확인할 수 없습니다." }); continue;
    }
    if (word.choiceSafety && (word.choiceSafety.target.headword !== word.headword || word.choiceSafety.target.primaryMeaning !== word.primaryMeaning)) {
      excluded.push({ key: word.key, headword: word.headword, reason: "현재 보기 검토와 과거 뜻이 다릅니다." }); continue;
    }
    const entry: PracticeEntry = { id: ++id, entryId: word.latestVocabEntryId, key: word.key, raw: word, headword: word.headword,
      primaryMeaning: word.primaryMeaning, canonicalKey: word.key, eligibleDirections: current.eligibleDirections,
      ...(word.choiceSafety ? { choiceSafety: word.choiceSafety } : {}) };
    targets.push(entry); candidates.push(entry);
  }
  const allowed = buildDirectionalQuestionSets(targets, candidates);
  const valid = targets.filter(entry => {
    const okay = settings.englishToKoreanRatio === 100 ? allowed.englishCandidateIds.has(entry.id)
      : settings.englishToKoreanRatio === 0 ? allowed.koreanCandidateIds.has(entry.id)
        : allowed.englishCandidateIds.has(entry.id) || allowed.koreanCandidateIds.has(entry.id);
    if (!okay) excluded.push({ key: entry.key!, headword: entry.headword, reason: "이 방향의 서로 다른 보기가 부족합니다." });
    return okay;
  });
  const ordered = shuffle(valid, random);
  const englishOnly = ordered.filter(e => allowed.englishCandidateIds.has(e.id) && !allowed.koreanCandidateIds.has(e.id));
  const koreanOnly = ordered.filter(e => allowed.koreanCandidateIds.has(e.id) && !allowed.englishCandidateIds.has(e.id));
  const both = ordered.filter(e => allowed.englishCandidateIds.has(e.id) && allowed.koreanCandidateIds.has(e.id));
  const englishCount = Math.round(settings.questionCount * settings.englishToKoreanRatio / 100);
  const pickedEnglish = englishOnly.slice(0, englishCount), pickedKorean = koreanOnly.slice(0, settings.questionCount - englishCount);
  const neededBoth = settings.questionCount - pickedEnglish.length - pickedKorean.length;
  const picked = shuffle([...pickedEnglish, ...pickedKorean, ...both.slice(0, neededBoth)], random);
  let error: string | null = null;
  if (!source.words.length) error = "조건에 맞는 단어가 없습니다.";
  else if (settings.questionCount > valid.length || picked.length !== settings.questionCount) error = "문항 수나 출제 방향을 조정해 주세요.";
  const questions = error ? [] : createTargetedQuizQuestions(picked, candidates, settings.englishToKoreanRatio, random);
  return { candidates, selected: picked, questions, availableCount: valid.length, totalCount: source.words.length, excluded, error };
}
