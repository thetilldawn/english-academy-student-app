import { z } from "zod";
import type { QuizDirection } from "./question-types";
import { normalizeQuizChoice, normalizeQuizHeadword } from "./word-identity";

export const REVIEWED_CHOICE_POLICY_VERSION = "reviewed-choice-conflicts-v1";
const text = (maximum: number) => z.string().min(1).max(maximum).refine(value => value === value.trim());
export const reviewedChoiceSafetySchema = z.object({
  version: z.literal(REVIEWED_CHOICE_POLICY_VERSION),
  evidenceSha256: z.string().regex(/^[a-f0-9]{64}$/),
  target: z.object({ headword: text(160), primaryMeaning: text(500) }).strict(),
  exclusions: z.array(z.object({
    direction: z.enum(["english_to_korean", "korean_to_english"]),
    choice: text(500),
  }).strict()).max(2000),
}).strict().superRefine((policy, context) => {
  const seen = new Set<string>();
  for (const exclusion of policy.exclusions) {
    const normalized = exclusion.direction === "english_to_korean"
      ? normalizeQuizChoice(exclusion.choice) : normalizeQuizHeadword(exclusion.choice);
    const correct = exclusion.direction === "english_to_korean"
      ? normalizeQuizChoice(policy.target.primaryMeaning) : normalizeQuizHeadword(policy.target.headword);
    const key = `${exclusion.direction}:${normalized}`;
    if (!normalized || normalized === correct || seen.has(key)) {
      context.addIssue({ code: "custom", message: "보기 검토 정보의 제외 값이 올바르지 않습니다." });
    }
    seen.add(key);
  }
});
export type ReviewedChoiceSafety = z.infer<typeof reviewedChoiceSafetySchema>;
type Entry = { headword: string; primaryMeaning: string; choiceSafety?: ReviewedChoiceSafety };

export function compileReviewedChoiceSafety(entry: Entry) {
  const english = new Set<string>(), korean = new Set<string>();
  if (entry.choiceSafety !== undefined) {
    const parsed = reviewedChoiceSafetySchema.safeParse(entry.choiceSafety);
    if (!parsed.success ||
      parsed.data.target.headword !== entry.headword ||
      parsed.data.target.primaryMeaning !== entry.primaryMeaning) {
      throw new Error("보기 검토 정보를 확인하지 못했습니다.");
    }
    for (const exclusion of parsed.data.exclusions) {
      if (exclusion.direction === "english_to_korean") english.add(normalizeQuizChoice(exclusion.choice));
      else korean.add(normalizeQuizHeadword(exclusion.choice));
    }
  }
  return { english, korean, signature: JSON.stringify(entry.choiceSafety ?? null) };
}

/** Match the displayed answer, so another occurrence or copied ID cannot
 * reintroduce a reviewed conflicting choice. No synonym inference is applied. */
export function isReviewedChoiceExcluded(
  safety: ReturnType<typeof compileReviewedChoiceSafety>,
  candidate: Pick<Entry, "headword" | "primaryMeaning">,
  direction: QuizDirection,
) {
  return direction === "english_to_korean"
    ? safety.english.has(normalizeQuizChoice(candidate.primaryMeaning))
    : safety.korean.has(normalizeQuizHeadword(candidate.headword));
}
