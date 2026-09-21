import "server-only";
import { z } from "zod";
import { countReviewLevels } from "@/lib/admin/review-candidate";
import type { DirectReviewPreviewInput } from "@/lib/admin/direct-review-assignment-request";
import type { DirectReviewUnavailableItem } from "@/features/assignments/public-contracts";
import type { DirectReviewCandidate } from "@/lib/admin/direct-review-candidate";
import { selectReviewedQuestionPlans } from "@/lib/assignment/reviewed-question-planner";

export const reviewedChoicePlanRowSchema=z.object({vocab_entry_id:z.coerce.number().int().positive(),
  direction:z.enum(["english_to_korean","korean_to_english"]),
  choice_vocab_entry_ids:z.array(z.coerce.number().int().positive()).length(4)}).strict();

export function diagnoseReviewedDirectReviewSelection(input: DirectReviewPreviewInput, candidates: readonly DirectReviewCandidate[], rows: unknown) {
  const parsed = z.array(reviewedChoicePlanRowSchema).parse(rows);
  const candidateIds = new Set(candidates.map(candidate => candidate.vocabEntryId));
  if (new Set(parsed.map(row => `${row.vocab_entry_id}:${row.direction}`)).size !== parsed.length ||
    parsed.some(row => !candidateIds.has(row.vocab_entry_id)) ||
    candidates.some(candidate => candidate.datasetId !== input.datasetId || !input.reviewLevels.includes(candidate.reasonLevel)) ||
    new Set(candidates.map(candidate => candidate.sourceQuestionId)).size !== candidates.length ||
    new Set(candidates.map(candidate => candidate.headwordNormalized)).size !== candidates.length) {
    throw new Error("오답 자료 연결이 바뀌었습니다. 다시 확인해 주세요.");
  }
  const directions = input.englishToKoreanRatio === 100 ? ["english_to_korean"] : input.englishToKoreanRatio === 0 ? ["korean_to_english"] : ["english_to_korean", "korean_to_english"];
  const unavailableItems: DirectReviewUnavailableItem[] = [];
  const eligibleCandidates = candidates.filter(candidate => {
    const choices = parsed.filter(row => row.vocab_entry_id === candidate.vocabEntryId);
    const reason = !choices.length ? "target_unavailable" :
      !directions.every(direction => choices.some(row => row.direction === direction)) ? "direction_unavailable" :
      choices.some(row => new Set(row.choice_vocab_entry_ids).size !== 4 || !row.choice_vocab_entry_ids.includes(row.vocab_entry_id)) ? "insufficient_choices" : null;
    if (!reason) return true;
    unavailableItems.push({ sourceQuestionId: candidate.sourceQuestionId, vocabEntryId: candidate.vocabEntryId,
      headword: candidate.headwordNormalized, primaryMeaning: null, reason });
    return false;
  });
  const eligibleIds = new Set(eligibleCandidates.map(candidate => candidate.vocabEntryId));
  return { eligibleCandidates, unavailableItems, rows: parsed.filter(row => eligibleIds.has(row.vocab_entry_id)) };
}

/** A separate wrong-word test keeps its existing English/Korean meaning policy. */
export function buildReviewedDirectReviewSelection(input:DirectReviewPreviewInput,candidates:readonly DirectReviewCandidate[],rows:unknown){
  const parsed=z.array(reviewedChoicePlanRowSchema).parse(rows);
  const selected=candidates.slice(0,400);
  if(!selected.length) throw new Error("선택한 단계에 배정할 현재 오답이 없습니다.");
  if(selected.some(c=>c.datasetId!==input.datasetId || !input.reviewLevels.includes(c.reasonLevel)) ||
    new Set(selected.map(c=>c.sourceQuestionId)).size!==selected.length ||
    new Set(selected.map(c=>c.headwordNormalized)).size!==selected.length) throw new Error("오답 목록이 바뀌었습니다. 다시 확인해 주세요.");
  const ids=new Set(selected.map(c=>c.vocabEntryId));
  const byKey=new Map(parsed.map(r=>[`${r.vocab_entry_id}:${r.direction}`,r]));
  const requiredDirections=input.englishToKoreanRatio===100?["english_to_korean"]:input.englishToKoreanRatio===0?["korean_to_english"]:["english_to_korean","korean_to_english"];
  if(byKey.size!==parsed.length || parsed.some(r=>!ids.has(r.vocab_entry_id) || new Set(r.choice_vocab_entry_ids).size!==4 || !r.choice_vocab_entry_ids.includes(r.vocab_entry_id)) ||
    selected.some(c=>!requiredDirections.every(d=>byKey.has(`${c.vocabEntryId}:${d}`)))) throw new Error("검토된 오답 문제가 부족하거나 연결이 바뀌었습니다.");
  const levels=countReviewLevels(selected.map(c=>c.reasonLevel));
  return {sourceQuestionIds:selected.map(c=>c.sourceQuestionId),reviewLevels:[...input.reviewLevels].sort((a,b)=>a-b),
    wrongLevel1Eligible:levels.level1,wrongLevel2Eligible:levels.level2,
    questions:selectReviewedQuestionPlans(selected.map(c=>c.vocabEntryId),parsed,input.englishToKoreanRatio,`${input.studentId}:${input.datasetId}:${selected.map(c=>c.sourceQuestionId).join(":")}`)};
}
