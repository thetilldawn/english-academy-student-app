import "server-only";
import { checkedAssignmentCountBreakdown } from "../../domain/assignment-count-breakdown";
import { loadSelectedVocabularyRowCount } from "../queries/bulk-assignment-planning-query";
import { z } from "zod";
import { assignmentQuestionModeErrors, assignmentQuestionModeIssues } from "../../domain/assignment-question-mode-policy";
import { cataloguedDatasetDisplayLabel } from "@/lib/admin/dataset-catalog";
import { resolveOrderedUnitSelection } from "@/lib/admin/unit-range";
import { unitSelectionLabel } from "../../domain/unit-selection-label";
import { planDirectionalVocabSeriesTargets } from "../../domain/vocab-series-target-planner";
import type { PlannedVocabSeriesTarget, VocabTargetDirection } from "../../domain/vocab-assignment-contract";
import { resolvePlanUnitAllocation } from "../../domain/vocab-plan-unit-allocation";
import { resolveVocabQuestionCycleAllocation } from "../../domain/vocab-question-allocation";
import type { AdminContext } from "@/lib/auth/admin";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import type { BulkAssignmentPreviewInput } from "../../contracts/bulk-assignment-request";
import type { BulkAssignmentPreview, BulkAssignmentPreviewFieldKey, BulkAssignmentPreviewItem, BulkAssignmentPreviewSession } from "../../contracts/bulk-assignment-response";
import { loadCommonBulkAssignmentPlanningData, type CommonBulkAssignmentPlanningData } from "../queries/bulk-assignment-planning-query";
import { resolvedBulkPlanSha256 } from "../planning/bulk-assignment-plan-digest";
import { commonPlanSchedule, extendCommonPlanSchedule, buildCommonPlanSummary } from "../planning/bulk-session-layout";
import { BulkAssignmentError } from "./bulk-assignment-errors";
import { MAXIMUM_BULK_ASSIGNMENT_COUNT } from "../../domain/model";
import { MAXIMUM_BULK_QUESTION_COUNT } from "./bulk-assignment-limits";

const candidateSchema = z.object({
  release_id: z.uuid(), package_sha256: z.string().regex(/^[0-9a-f]{64}$/i),
  vocab_entry_id: z.coerce.number().int().positive(), unit_id: z.uuid(),
  source_row: z.coerce.number().int().positive(), question_item_id: z.string().min(1),
  question_item_sha256: z.string().regex(/^[0-9a-f]{64}$/i),
  direction: z.enum(["english_to_korean", "korean_to_english"]).optional(),
}).strict();
type Candidate = z.infer<typeof candidateSchema> & { direction: VocabTargetDirection };
export type CanonicalPlannedQuestion = {
  id: number; direction: VocabTargetDirection;
  questionItemId: string; questionItemSha256: string;
  releaseId: string; packageSha256: string;
  bankSource: "canonical_legacy" | "reviewed_exam_v1";
};
export type CanonicalResolvedBulkAssignmentPreview = {
  preview: BulkAssignmentPreview;
  targetPlansByStudent: Map<string, PlannedVocabSeriesTarget[][]>;
  canonicalPlansByStudent: Map<string, CanonicalPlannedQuestion[][]>;
};

async function loadCandidates(input: BulkAssignmentPreviewInput, unitIds: string[], reviewed: boolean): Promise<Candidate[]> {
  const client = await createServerSupabaseClient();
  const { data, error } = await client.rpc(
    reviewed ? "list_active_reviewed_exam_questions_v1" : "list_active_canonical_question_preview_v1",
    { p_dataset_id: input.commonPlan.datasetId, p_unit_ids: unitIds, p_quiz_mode: input.questionMode },
  );
  if (error) throw new BulkAssignmentError("database", "검토된 시험 문제를 불러오지 못했습니다. 다시 시도해 주세요.");
  const parsed = z.array(candidateSchema).safeParse(data);
  if (!parsed.success) throw new BulkAssignmentError("database", "시험 문제 목록의 형식이 올바르지 않습니다.");
  const candidates = parsed.data.map((candidate): Candidate => ({
    ...candidate,
    direction: candidate.direction ?? "korean_to_english",
  }));
  const keys = candidates.map(c => `${c.vocab_entry_id}:${c.direction}`);
  if (new Set(keys).size !== keys.length ||
      new Set(candidates.map(c => c.release_id)).size > 1 ||
      new Set(candidates.map(c => c.package_sha256)).size > 1 ||
      (reviewed && parsed.data.some(c => !c.direction))) {
    throw new BulkAssignmentError("database", "시험 문제의 버전이나 출제 방향이 서로 맞지 않습니다.");
  }
  return candidates;
}

function targetCandidates(candidates: readonly Candidate[]) {
  const grouped = new Map<number, { id: number; eligibleDirections: VocabTargetDirection[] }>();
  for (const candidate of candidates) {
    const item = grouped.get(candidate.vocab_entry_id) ?? { id: candidate.vocab_entry_id, eligibleDirections: [] };
    item.eligibleDirections.push(candidate.direction);
    grouped.set(item.id, item);
  }
  return [...grouped.values()];
}

export async function resolveCanonicalBulkAssignmentPreview(
  input: BulkAssignmentPreviewInput,
  admin: AdminContext,
  preparedPlanning?: CommonBulkAssignmentPlanningData,
): Promise<CanonicalResolvedBulkAssignmentPreview> {
  const plan = input.commonPlan;
  const issues = assignmentQuestionModeIssues(input.questionMode, input.englishToKoreanRatio, plan);
  if (issues.direction) {
    throw new BulkAssignmentError("invalid_selection", assignmentQuestionModeErrors.direction);
  }
  const planning = preparedPlanning ?? await loadCommonBulkAssignmentPlanningData(
    { datasetId: plan.datasetId, studentIds: input.studentIds }, admin);
  const reviewed = planning.dataset?.questionBankKind === "reviewed_exam_v1";
  if (!reviewed && (input.questionMode === "book_meaning_choice" || input.questionMode === "canonical_headword_to_definition")) {
    throw new BulkAssignmentError("invalid_selection", "이 단어장에는 선택한 방향의 검토된 문제가 없습니다.");
  }
  const ready = Boolean(planning.dataset?.status === "ready" && planning.dataset.isActive && planning.dataset.isAssignable);
  const datasetLabel = planning.dataset ? cataloguedDatasetDisplayLabel(planning.dataset) : null;
  let selectedUnits: typeof planning.units = [];
  let planningError: string | null = null;
  let planningErrorFieldKey: BulkAssignmentPreviewFieldKey = "range";
  const failPlanning = (field: BulkAssignmentPreviewFieldKey, message: string): never => {
    planningErrorFieldKey = field;
    throw new Error(message);
  };
  try { selectedUnits = resolveOrderedUnitSelection(planning.units, plan.orderedUnitIds); }
  catch { planningError = "선택한 시험 범위를 사용할 수 없습니다."; }
  const unitRank = new Map(selectedUnits.map((unit,index)=>[unit.id,index]));
  const candidates = ready && !planningError ? (await loadCandidates(input, selectedUnits.map(u => u.id), reviewed))
    .sort((a,b)=>(unitRank.get(a.unit_id) ?? Infinity)-(unitRank.get(b.unit_id) ?? Infinity) || a.source_row-b.source_row) : [];
  const directionsNeeded: VocabTargetDirection[] = input.englishToKoreanRatio === 100 ? ["english_to_korean"]
    : input.englishToKoreanRatio === 0 ? ["korean_to_english"] : ["english_to_korean", "korean_to_english"];
  const eligible = targetCandidates(candidates).filter(c => directionsNeeded.every(d => c.eligibleDirections.includes(d)));
  const eligibleIds = new Set(eligible.map(c => c.id));
  const usable = candidates.filter(c => eligibleIds.has(c.vocab_entry_id));
  const availableCount = eligible.length;
  const countBreakdown = ready && !planningError ? checkedAssignmentCountBreakdown({
    sourceCount: await loadSelectedVocabularyRowCount(plan.datasetId, selectedUnits.map(unit => unit.id)),
    candidateCount: targetCandidates(candidates).length,
    activeReviewExcludedCount: 0,
    directionExcludedCount: targetCandidates(candidates).length - availableCount,
    choiceExcludedCount: 0,
    allocationExcludedCount: 0,
    availableCount,
  }) : null;
  const maximumCount = Math.min(availableCount, 500);
  let schedule = commonPlanSchedule(input);
  let defaultSessionCount = 1;
  let requiresExtraDateDecision = false;
  let cycleIndexes: number[] = [];
  let sessionUnits: typeof planning.units[] = [];
  let counts: number[] = [];
  try {
    if (!ready) failPlanning("dataset", "현재 배정할 수 없는 단어장입니다.");
    if (planningError) throw new Error(planningError);
    if (availableCount < 4) throw new Error("선택한 범위에 검토된 문제가 4개보다 적습니다.");
    if (plan.splitBasis === "range_unit") {
      const allocation = resolvePlanUnitAllocation(plan);
      defaultSessionCount = allocation.defaultSessionCount;
      requiresExtraDateDecision = allocation.requiresExtraDateDecision;
      cycleIndexes = allocation.sessionCycleIndexes;
      sessionUnits = plan.sessions.map(s => resolveOrderedUnitSelection(planning.units, s.unitIds));
      counts = sessionUnits.map(units => {
        const selected = new Set(units.map(u => u.id));
        const capacity = new Set(usable.filter(c => selected.has(c.unit_id)).map(c => c.vocab_entry_id)).size;
        const count = plan.questionCount.mode === "all" ? Math.min(capacity, 500) : plan.questionCount.value;
        if (count < 4 || count > Math.min(capacity, 500)) failPlanning("range", `현재 회차는 검토된 문제를 최대 ${Math.min(capacity, 500)}개까지 배정할 수 있습니다. 회차당 단위 수를 늘리거나 범위를 조정해 주세요.`);
        return count;
      });
    } else {
      const allocation = resolveVocabQuestionCycleAllocation({
        availableQuestionCount: plan.distribution === "repeat" ? maximumCount : availableCount, distribution: plan.distribution, questionCount: plan.questionCount,
        selectedDateCount: plan.selectedDateCount, overflowPolicy: plan.overflowPolicy, extraDatePolicy: plan.extraDatePolicy,
        maximumSessionQuestionCount: maximumCount, maximumSessionCount: MAXIMUM_BULK_ASSIGNMENT_COUNT,
      });
      if (allocation.issue) failPlanning(allocation.issue === "series_session_limit_exceeded" ? "preview" : plan.questionCount.mode === "manual" ? "questionCount" : "range", allocation.issue === "series_session_limit_exceeded"
        ? `한 번에 배정할 수 있는 시험은 ${MAXIMUM_BULK_ASSIGNMENT_COUNT}회까지입니다. 회차당 단어 수를 늘리거나 범위를 줄여 주세요.`
        : allocation.issue === "missing_schedule" ? "배정할 요일을 선택해 주세요."
        : `회차별 단어 수와 날짜를 확인해 주세요. 한 회차에는 최대 ${maximumCount}개까지 배정할 수 있습니다.`);
      counts = allocation.sessionQuestionCounts;
      cycleIndexes = allocation.sessionCycleIndexes;
      defaultSessionCount = allocation.defaultSessionCount;
      requiresExtraDateDecision = allocation.requiresExtraDateDecision;
      schedule = extendCommonPlanSchedule(schedule, plan.recurrenceSessions, counts.length);
      sessionUnits = counts.map(() => selectedUnits);
    }
    if (counts.length !== schedule.length || counts.length === 0) failPlanning("preview", "배정할 회차와 일정의 개수를 확인해 주세요.");
    if (counts.length * input.studentIds.length > MAXIMUM_BULK_ASSIGNMENT_COUNT ||
        counts.reduce((a,b) => a+b,0) * input.studentIds.length > MAXIMUM_BULK_QUESTION_COUNT) {
      failPlanning("preview", "한 번에 배정할 수 있는 시험은 전체 210회, 문항은 전체 10,000개까지입니다. 학생이나 범위·회차 수를 줄여 주세요.");
    }
  } catch (error) { planningError = error instanceof Error ? error.message : "시험 회차를 계산하지 못했습니다."; }
  const candidateByKey = new Map(usable.map(c => [`${c.vocab_entry_id}:${c.direction}`, c]));
  const studentById = new Map(planning.students.map(s => [s.id, s]));
  const targetPlansByStudent = new Map<string, PlannedVocabSeriesTarget[][]>();
  const canonicalPlansByStudent = new Map<string, CanonicalPlannedQuestion[][]>();
  const items = input.studentIds.map((studentId): BulkAssignmentPreviewItem => {
    const student = studentById.get(studentId);
    const itemBase = { studentId, studentName: student?.displayName ?? "확인할 수 없는 학생",
      countBreakdown,
      datasetId: plan.datasetId, datasetLabel, availableQuestionCount: availableCount,
      totalAvailableQuestionCount: availableCount, maximumSessionQuestionCount: maximumCount,
      selectedQuestionCount: 0, remainingQuestionCount: availableCount, defaultSessionCount,
      scheduledQuestionCount: 0, requiresExtraDateDecision };
    const studentUnavailable = !student || student.status !== "active";
    const error = studentUnavailable ? "접속 가능한 학생이 아닙니다." : planningError;
    if (error) return { ...itemBase, available: false, sessions: [], error,
      errorFieldKey: studentUnavailable ? "students" : planningErrorFieldKey };
    const targets: PlannedVocabSeriesTarget[][] = counts.map(() => []);
    if (plan.splitBasis === "range_unit") {
      sessionUnits.forEach((units, index) => {
        const selected = new Set(units.map(u => u.id));
        targets[index] = planDirectionalVocabSeriesTargets({
          candidates: targetCandidates(usable.filter(c => selected.has(c.unit_id))),
          distribution: "repeat", selectionMode: plan.selectionMode, sessionQuestionCounts: [counts[index]!],
          englishToKoreanRatio: input.englishToKoreanRatio,
          seedScope: `${plan.planNonce}:${studentId}:${index}:${input.questionMode}`,
        })[0] ?? [];
      });
    } else {
      for (const cycle of new Set(cycleIndexes)) {
        const indexes = counts.map((_,i) => i).filter(i => cycleIndexes[i] === cycle);
        const plans = planDirectionalVocabSeriesTargets({
          candidates: eligible, distribution: plan.distribution, selectionMode: plan.selectionMode,
          sessionQuestionCounts: indexes.map(i => counts[i]!), englishToKoreanRatio: input.englishToKoreanRatio,
          seedScope: `${plan.planNonce}:${studentId}:${cycle}:${input.questionMode}`,
        });
        indexes.forEach((index, offset) => { targets[index] = plans[offset] ?? []; });
      }
    }
    const bankPlans = targets.map((list): CanonicalPlannedQuestion[] => list.flatMap(target => {
      const candidate = candidateByKey.get(`${target.id}:${target.direction}`);
      return candidate ? [{ id: target.id, direction: target.direction,
        questionItemId: candidate.question_item_id, questionItemSha256: candidate.question_item_sha256,
        releaseId: candidate.release_id, packageSha256: candidate.package_sha256,
        bankSource: reviewed ? "reviewed_exam_v1" as const : "canonical_legacy" as const }] : [];
    }));
    if (bankPlans.some((p,i) => p.length !== counts[i])) return { ...itemBase, available:false,sessions:[],
      error:"회차별 출제 대상을 확정하지 못했습니다. 범위를 다시 확인해 주세요.",errorFieldKey:"preview" };
    targetPlansByStudent.set(studentId, targets);
    canonicalPlansByStudent.set(studentId, bankPlans);
    const sessions: BulkAssignmentPreviewSession[] = counts.map((count,i) => ({
      sessionNumber:i+1,sourceSessionNumber:i+1,cycleIndex:cycleIndexes[i] ?? 0,available:true,
      unitId:sessionUnits[i]?.[0]?.id ?? null,unitLabel:unitSelectionLabel(sessionUnits[i] ?? []),
      unitIds:(sessionUnits[i] ?? []).map(u=>u.id),unitLabels:(sessionUnits[i] ?? []).map(u=>u.label),
      rangeTruncated:false,questionCount:count,availableFrom:schedule[i]!.availableFrom,
      availableUntil:schedule[i]!.availableUntil,error:null,
    }));
    const scheduledCount = counts.reduce((a,b) => a+b,0);
    const selectedCount = plan.distribution === "split" ? Math.min(availableCount, scheduledCount) : counts[0] ?? 0;
    return { ...itemBase, available:true,sessions,error:null,selectedQuestionCount:selectedCount,
      uniqueScheduledQuestionCount: new Set(targets.flat().map(target => target.id)).size,
      remainingQuestionCount:Math.max(0,availableCount-selectedCount),scheduledQuestionCount:scheduledCount };
  });
  const valid = [...canonicalPlansByStudent.values()].flat(2);
  const preview: BulkAssignmentPreview = {
    items,assignableCount:items.filter(i=>i.available).length,blockedCount:items.filter(i=>!i.available).length,
    assignmentCount:items.filter(i=>i.available).reduce((n,i)=>n+i.sessions.length,0),
    commonPlanSummary:buildCommonPlanSummary(items),rangeLabel:selectedUnits.length?unitSelectionLabel(selectedUnits):null,
    planSignature:resolvedBulkPlanSha256(items.map(item=>({
      studentId:item.studentId,datasetId:item.datasetId,
      sessions:item.sessions.map((s,i)=>({...s,targets:(canonicalPlansByStudent.get(item.studentId)?.[i] ?? []).map(t=>({
        id:t.id,direction:t.direction,questionItemId:t.questionItemId,questionItemSha256:t.questionItemSha256,
      }))})),
    })), { ...plan, questionMode:input.questionMode,canonicalReleaseId:valid[0]?.releaseId ?? null,
      canonicalPackageSha256:valid[0]?.packageSha256 ?? null }),
  };
  return { preview,targetPlansByStudent,canonicalPlansByStudent };
}
