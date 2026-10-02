import "server-only";
import { z } from "zod";
import { buildMistakePracticePlan, mistakePracticeSourceSchema, practiceHash, seededRandom } from "@/features/quiz-player/public-server";
import { resolveOrderedUnitSelection } from "@/lib/admin/unit-range";
import { buildQuizChoiceIndex, quizIndependentTargetDirectionEligibility } from "@/lib/quiz/choice-policy";
import { createExplicitTargetedQuizQuestions } from "@/lib/quiz/question-generator";
import { loadEligibleVocabularyDataset } from "@/lib/services/eligible-vocabulary-service";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { mixedMistakePreviewSchema, toMixedMistakePreviewInput, type MixedMistakePreviewInput } from "../../contracts/mixed-mistake-assignment";
import { splitMistakeAssignmentBanks } from "../../domain/mistake-assignment-banks";
import { PrimaryPlannerLimitError, selectMixedPrimaryExact } from "../../domain/mixed-mistake-primary-plan";
import { NotebookAssignmentError, notebookAssignmentRpc } from "../persistence/notebook-assignment";

const hash = z.string().regex(/^[a-f0-9]{64}$/);
const direction = z.enum(["english_to_korean", "korean_to_english"]);
const sourceSchema = mistakePracticeSourceSchema.extend({
  schemaVersion: z.literal("mixed-mistake-source-v1"), blockedPrimaryMeaningKeys: z.array(hash), queueIds: z.array(z.uuid()),
  words: z.array(mistakePracticeSourceSchema.shape.words.element.extend({ queueId: z.uuid(), reasonLevel: z.union([z.literal(1), z.literal(2)]),
    latestDatasetId: z.uuid(), stateVersion: z.string().regex(/^\d+$/), assignmentAvailable: z.boolean() })).max(500),
  datasets: z.array(z.object({ id: z.uuid(), available: z.boolean() })),
});
const proofSchema = z.object({ schemaVersion: z.literal("mixed-primary-meanings-v1"), datasetId: z.uuid(),
  sourceKind: z.enum(["raw-v2", "exam-use"]), unitIds: z.array(z.uuid()), sourceHash: hash,
  items: z.array(z.object({ entryId: z.number().int().positive(), direction, meaningKey: hash, wordKey: z.string().min(1), meaningProofHash: hash })).max(20000),
});
type Proof = z.infer<typeof proofSchema>["items"][number];
export function mixedMistakeSelection(input: MixedMistakePreviewInput) {
  return { mode: "mixed", datasetId: input.datasetId, primaryUnitIds: input.primaryUnitIds, reviewScope: input.reviewScope, reviewLevels: [...input.reviewLevels].sort() };
}
export async function loadMixedPrimaryProof(adminId: string, input: MixedMistakePreviewInput, requests: { entryId: number; direction: z.infer<typeof direction> }[]) {
  if (!requests.length) return null;
  const proof = proofSchema.parse(await notebookAssignmentRpc("preview_mixed_primary_meanings_v1", {
    p_admin_id: adminId, p_dataset_id: input.datasetId, p_unit_ids: input.primaryUnitIds, p_requests: requests,
  }));
  const requested = new Set(requests.map(item => `${item.entryId}:${item.direction}`));
  if (proof.datasetId !== input.datasetId || proof.items.length !== requests.length ||
    new Set(proof.items.map(item => `${item.entryId}:${item.direction}`)).size !== requested.size ||
    proof.items.some(item => !requested.has(`${item.entryId}:${item.direction}`)) ||
    new Set(proof.unitIds).size !== input.primaryUnitIds.length || proof.unitIds.some(id => !input.primaryUnitIds.includes(id))) {
    throw new NotebookAssignmentError(409, "단어장의 뜻 연결이 달라졌습니다. 다시 확인해 주세요.", "source_changed");
  }
  return proof;
}

export async function prepareMixedMistakeAssignment(adminId: string, rawInput: MixedMistakePreviewInput) {
  const input = toMixedMistakePreviewInput(rawInput);
  const supabase = await createServerSupabaseClient();
  const [sourceValue, unitResult, allCandidates] = await Promise.all([
    notebookAssignmentRpc("prepare_mixed_mistake_source_v1", { p_admin_id: adminId, p_student_id: input.studentId, p_selection: mixedMistakeSelection(input) }),
    supabase.from("vocab_units").select("id,sort_index").eq("dataset_id", input.datasetId).order("sort_index"),
    loadEligibleVocabularyDataset(supabase, input.datasetId, { includeExamUseProjection: true }),
  ]);
  if (unitResult.error) throw new NotebookAssignmentError(503, "단어장 범위를 불러오지 못했습니다. 다시 확인해 주세요.");
  const availableUnits = z.array(z.object({ id: z.uuid(), sort_index: z.number().int() })).parse(unitResult.data)
    .map(unit => ({ id: unit.id, sortIndex: unit.sort_index }));
  let units: typeof availableUnits;
  try { units = resolveOrderedUnitSelection(availableUnits, input.primaryUnitIds); }
  catch { throw new NotebookAssignmentError(409, "단어장 범위가 달라졌습니다. 범위를 다시 선택해 주세요.", "source_changed"); }
  const source = sourceSchema.parse(sourceValue), available = new Set(source.datasets.filter(value => value.available).map(value => value.id));
  if (new Set(source.words.map(word => word.meaningKey)).size !== source.words.length ||
      new Set(source.words.map(word => word.queueId)).size !== source.words.length ||
      source.queueIds.length !== source.words.length || source.words.some(word => !source.queueIds.includes(word.queueId))) {
    throw new NotebookAssignmentError(409, "오답의 뜻 연결이 달라졌습니다. 다시 확인해 주세요.", "source_changed");
  }
  const excluded = source.words.filter(word => !word.assignmentAvailable || !available.has(word.latestDatasetId))
    .map(word => ({ key: word.key, headword: word.headword, reason: "현재 배정할 수 없는 뜻입니다." }));
  const allowed = { ...source, words: source.words.filter(word => word.assignmentAvailable && available.has(word.latestDatasetId)),
    candidates: source.candidates.filter(candidate => available.has(candidate.datasetId)) };
  const seed = practiceHash({ operation: "mixed-mistake-plan-v1", input, sourceHash: source.sourceHash });
  const practiceSettings = { questionCount: Math.max(1, allowed.words.length), englishToKoreanRatio: input.englishToKoreanRatio,
    timingMode: "none" as const, timeLimitSeconds: null, questionTimeLimitSeconds: null };
  const diagnosis = buildMistakePracticePlan(allowed, practiceSettings, seed, { separateBanks: true });
  const reviewOptions = diagnosis.directionOptions.filter(option => {
    const usable = input.englishToKoreanRatio === 100 ? option.english : input.englishToKoreanRatio === 0 ? option.korean : option.english || option.korean;
    if (!usable) excluded.push({ key: option.word.key, headword: option.word.headword, reason: "원래 문항의 출제 방향을 이 시험에 넣을 수 없습니다." });
    return usable;
  });
  const ordered = units.flatMap(unit => allCandidates.filter(candidate => candidate.unitId === unit.id).sort((a, b) => a.sourceRow - b.sourceRow || a.id - b.id));
  const eligibility = quizIndependentTargetDirectionEligibility(ordered, allCandidates);
  const requests = eligibility.flatMap(row => row.eligibleDirections.map(direction => ({ entryId: row.id, direction })));
  const primaryProof = await loadMixedPrimaryProof(adminId, input, requests);
  const proofByPair = new Map((primaryProof?.items ?? []).map(item => [`${item.entryId}:${item.direction}`, item]));
  const blocked = new Set([...source.blockedPrimaryMeaningKeys, ...source.words.map(word => word.meaningKey)]);
  const candidates = eligibility.map(row => ({ entryId: row.id, options: row.eligibleDirections.map(direction => proofByPair.get(`${row.id}:${direction}`)!)
    .filter(option => !blocked.has(option.meaningKey)) }));
  const count = reviewOptions.length;
  const emptyPlan = { ...diagnosis, items: [], selected: [], error: null };
  const basePreview = { planVersion: "meaning-episode-v1" as const, totalQuestionCount: input.totalQuestionCount, primaryQuestionCount: Math.max(0, input.totalQuestionCount - count),
    reviewMeaningCount: count, availablePrimaryCount: candidates.filter(candidate => candidate.options.length).length, candidateReviewCount: source.words.length,
    unavailableCount: excluded.length, unavailableItems: excluded };
  const failure = (error: string) => ({ input, source, plan: emptyPlan, primary: [], primaryRequests: [], primarySourceHash: null,
    banks: [], preview: mixedMistakePreviewSchema.parse({ ...basePreview, selectionFingerprint: null, banks: [], error }) });
  if (!count) return failure("이 조건에서 추가할 오답이 없습니다. 오답 단계나 범위를 확인해 주세요.");
  if (count > input.totalQuestionCount) return failure(`오답 ${count}개를 모두 포함하려면 전체 문항 수를 ${count}개 이상으로 늘려 주세요.`);
  let selected;
  try {
    selected = selectMixedPrimaryExact({ candidates, totalQuestionCount: input.totalQuestionCount,
      englishCount: Math.round(input.totalQuestionCount * input.englishToKoreanRatio / 100), blockedMeaningKeys: [...blocked],
      review: { meaningKeys: reviewOptions.map(option => option.word.meaningKey),
        englishMin: reviewOptions.filter(option => option.english && !option.korean).length,
        englishMax: reviewOptions.filter(option => option.english).length } });
  } catch (error) { if (error instanceof PrimaryPlannerLimitError) return failure(error.message); throw error; }
  if (!selected) return failure("선택한 범위와 오답으로 문항 수·출제 비율을 맞출 수 없습니다. 범위나 시험 조건을 조정해 주세요.");
  const reviewMeanings = new Set(reviewOptions.map(option => option.word.meaningKey));
  const plan = buildMistakePracticePlan({ ...allowed, words: allowed.words.filter(word => reviewMeanings.has(word.meaningKey)) },
    { ...practiceSettings, questionCount: count }, seed, { separateBanks: true, exactEnglishCount: selected.reviewEnglishCount });
  if (plan.error || plan.items.length !== count) return failure(plan.error ?? "오답 문항을 준비하지 못했습니다. 다시 확인해 주세요.");
  const sourceOrder = new Map(source.words.map((word, index) => [word.meaningKey, index]));
  plan.items.sort((a, b) => sourceOrder.get(a.word.meaningKey)! - sourceOrder.get(b.word.meaningKey)!);
  const random = seededRandom(seed), choiceIndex = buildQuizChoiceIndex(allCandidates);
  const primary = selected.primary.map(pick => {
    const proof: Proof = proofByPair.get(`${pick.entryId}:${pick.direction}`)!;
    const generated = createExplicitTargetedQuizQuestions([{ id: pick.entryId, direction: pick.direction }], allCandidates, random, { choiceIndex })[0];
    return { kind: "primary" as const, proof, word: { meaningKey: proof.meaningKey, wordKey: proof.wordKey, latestVocabEntryId: pick.entryId,
      frozenQuestion: { ...generated, quizContentMode: "book_meaning_choice" } }, generated };
  });
  type Item = typeof primary[number] | (typeof plan.items[number] & { kind: "review" });
  const items: Item[] = [...primary, ...plan.items.map(item => ({ ...item, kind: "review" as const }))];
  const partition = splitMistakeAssignmentBanks(items, input.timingMode === "total" ? input.timeLimitSeconds : null);
  if (partition.error) return failure(partition.error);
  const primaryRequests = primary.map(item => ({ entryId: item.proof.entryId, direction: item.proof.direction }));
  const selectedProof = await loadMixedPrimaryProof(adminId, input, primaryRequests);
  if (selectedProof?.items.some(item => proofByPair.get(`${item.entryId}:${item.direction}`)?.meaningProofHash !== item.meaningProofHash)) {
    throw new NotebookAssignmentError(409, "단어장의 뜻 연결이 달라졌습니다. 다시 확인해 주세요.", "source_changed");
  }
  const banks = partition.banks.map(bank => ({ ...bank, primaryQuestionCount: bank.items.filter(item => item.kind === "primary").length,
    reviewMeaningCount: bank.items.filter(item => item.kind === "review").length }));
  const fingerprint = practiceHash({ input, sourceHash: source.sourceHash, primarySourceHash: selectedProof?.sourceHash ?? null,
    candidateProofHash: primaryProof?.sourceHash ?? null, banks });
  const preview = mixedMistakePreviewSchema.parse({ ...basePreview, selectionFingerprint: fingerprint, error: null,
    banks: banks.map(({ index, questionCount, primaryQuestionCount, reviewMeaningCount, quizContentMode, englishToKoreanRatio, timeLimitSeconds }) =>
      ({ index, questionCount, primaryQuestionCount, reviewMeaningCount, quizContentMode, englishToKoreanRatio, timeLimitSeconds })) });
  return { input, source, plan, primary, primaryRequests, primarySourceHash: selectedProof?.sourceHash ?? null, banks, preview };
}
