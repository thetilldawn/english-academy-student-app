import "server-only";

import { z } from "zod";

import { cataloguedDatasetDisplayLabel } from "@/lib/admin/dataset-catalog";
import { resolveOrderedUnitSelection } from "@/lib/admin/unit-range";
import { unitSelectionLabel } from "@/features/assignments/domain/unit-selection-label";
import { planDirectionalVocabSeriesTargets } from "@/features/assignments/domain/vocab-series-target-planner";
import type { PlannedVocabSeriesTarget } from "@/features/assignments/domain/vocab-assignment-contract";
import type { AdminContext } from "@/lib/auth/admin";
import { createServerSupabaseClient } from "@/lib/supabase/server";

import type { BulkAssignmentPreviewInput } from "../../contracts/bulk-assignment-request";
import type {
  BulkAssignmentPreview,
  BulkAssignmentPreviewItem,
} from "../../contracts/bulk-assignment-response";
import { loadCommonBulkAssignmentPlanningData } from "../queries/bulk-assignment-planning-query";
import { resolvedBulkPlanSha256 } from "../planning/bulk-assignment-plan-digest";
import { BulkAssignmentError } from "./bulk-assignment-errors";

const canonicalCandidateSchema = z.object({
  release_id: z.uuid(),
  package_sha256: z.string().regex(/^[0-9a-f]{64}$/i),
  vocab_entry_id: z.coerce.number().int().positive(),
  unit_id: z.uuid(),
  source_row: z.coerce.number().int().positive(),
  question_item_id: z.string().min(1),
  question_item_sha256: z.string().regex(/^[0-9a-f]{64}$/i),
}).strict();

export type CanonicalPlannedQuestion = {
  id: number;
  direction: "korean_to_english";
  questionItemId: string;
  questionItemSha256: string;
  releaseId: string;
  packageSha256: string;
};

export type CanonicalResolvedBulkAssignmentPreview = {
  preview: BulkAssignmentPreview;
  targetPlansByStudent: Map<string, PlannedVocabSeriesTarget[][]>;
  canonicalPlansByStudent: Map<string, CanonicalPlannedQuestion[]>;
};

async function loadCanonicalCandidates(input: {
  datasetId: string;
  unitIds: readonly string[];
  quizMode: Exclude<
    BulkAssignmentPreviewInput["questionMode"],
    "book_meaning_choice"
  >;
}) {
  const supabase = await createServerSupabaseClient();
  const { data, error } = await supabase.rpc(
    "list_active_canonical_question_preview_v1",
    {
      p_dataset_id: input.datasetId,
      p_unit_ids: [...input.unitIds],
      p_quiz_mode: input.quizMode,
    },
  );
  if (error) {
    throw new BulkAssignmentError(
      "database",
      "검수된 영영풀이·예문 문제를 불러오지 못했습니다.",
    );
  }
  const parsed = z.array(canonicalCandidateSchema).safeParse(data);
  if (!parsed.success) {
    throw new BulkAssignmentError(
      "database",
      "검수된 문제 목록의 형식이 올바르지 않습니다.",
    );
  }
  const releaseIds = new Set(parsed.data.map((item) => item.release_id));
  const packageHashes = new Set(parsed.data.map((item) => item.package_sha256));
  const vocabIds = parsed.data.map((item) => item.vocab_entry_id);
  if (
    parsed.data.length > 0 &&
    (releaseIds.size !== 1 ||
      packageHashes.size !== 1 ||
      new Set(vocabIds).size !== vocabIds.length)
  ) {
    throw new BulkAssignmentError(
      "database",
      "검수된 문제 묶음의 버전이 서로 섞여 있습니다.",
    );
  }
  return parsed.data;
}

function unavailableItem(input: {
  studentId: string;
  studentName: string;
  datasetId: string;
  datasetLabel: string | null;
  message: string;
  field: "dataset" | "students" | "range" | "questionCount" | "preview";
}): BulkAssignmentPreviewItem {
  return {
    studentId: input.studentId,
    studentName: input.studentName,
    available: false,
    datasetId: input.datasetId,
    datasetLabel: input.datasetLabel,
    sessions: [],
    availableQuestionCount: null,
    selectedQuestionCount: null,
    remainingQuestionCount: null,
    defaultSessionCount: null,
    scheduledQuestionCount: null,
    requiresExtraDateDecision: false,
    error: input.message,
    errorFieldKey: input.field,
  };
}

export async function resolveCanonicalBulkAssignmentPreview(
  input: BulkAssignmentPreviewInput,
  admin: AdminContext,
): Promise<CanonicalResolvedBulkAssignmentPreview> {
  if (input.questionMode === "book_meaning_choice") {
    throw new BulkAssignmentError("invalid_selection");
  }
  const plan = input.commonPlan;
  if (
    input.englishToKoreanRatio !== 0 ||
    plan.selectedDateCount !== 0 ||
    plan.sessions.length !== 1 ||
    plan.sessions[0]?.availableFrom !== null ||
    plan.sessions[0]?.availableUntil !== null
  ) {
    throw new BulkAssignmentError(
      "invalid_selection",
      "영영풀이·예문 시험은 시험일 없이 1회만 바로 배정할 수 있습니다.",
    );
  }

  const planning = await loadCommonBulkAssignmentPlanningData(
    { datasetId: plan.datasetId, studentIds: input.studentIds },
    admin,
  );
  const dataset = planning.dataset;
  const studentById = new Map(
    planning.students.map((student) => [student.id, student]),
  );
  let selectedUnits: typeof planning.units = [];
  let rangeError: string | null = null;
  try {
    selectedUnits = resolveOrderedUnitSelection(
      planning.units,
      plan.orderedUnitIds,
    );
  } catch {
    rangeError = "선택한 공통 범위를 사용할 수 없습니다.";
  }
  const datasetLabel = dataset
    ? cataloguedDatasetDisplayLabel(dataset)
    : null;
  const datasetReady = Boolean(
    dataset?.status === "ready" && dataset.isActive && dataset.isAssignable,
  );
  const candidates = datasetReady && !rangeError
    ? await loadCanonicalCandidates({
        datasetId: plan.datasetId,
        unitIds: selectedUnits.map((unit) => unit.id),
        quizMode: input.questionMode,
      })
    : [];
  const availableQuestionCount = candidates.length;
  const requestedQuestionCount = plan.questionCount.mode === "all"
    ? availableQuestionCount
    : plan.questionCount.value;
  const countError = availableQuestionCount < 4
    ? "선택한 범위에 검수된 문제가 4개보다 적습니다."
    : requestedQuestionCount > availableQuestionCount
      ? `선택한 범위에서는 검수된 문제를 최대 ${availableQuestionCount}개까지 배정할 수 있습니다.`
      : null;

  const targetPlansByStudent = new Map<string, PlannedVocabSeriesTarget[][]>();
  const canonicalPlansByStudent = new Map<string, CanonicalPlannedQuestion[]>();
  const items = input.studentIds.map((studentId): BulkAssignmentPreviewItem => {
    const student = studentById.get(studentId);
    const studentName = student?.displayName ?? "확인할 수 없는 학생";
    if (!student || student.status !== "active") {
      return unavailableItem({
        studentId,
        studentName,
        datasetId: plan.datasetId,
        datasetLabel,
        message: "접속 가능한 학생이 아닙니다.",
        field: "students",
      });
    }
    if (!datasetReady) {
      return unavailableItem({
        studentId,
        studentName,
        datasetId: plan.datasetId,
        datasetLabel,
        message: "최근 단어장을 신규 배정 가능한 자료로 바꿔 주세요.",
        field: "dataset",
      });
    }
    if (rangeError) {
      return unavailableItem({
        studentId,
        studentName,
        datasetId: plan.datasetId,
        datasetLabel,
        message: rangeError,
        field: "range",
      });
    }
    if (countError) {
      return {
        ...unavailableItem({
          studentId,
          studentName,
          datasetId: plan.datasetId,
          datasetLabel,
          message: countError,
          field: "questionCount",
        }),
        availableQuestionCount,
        selectedQuestionCount: 0,
        remainingQuestionCount: availableQuestionCount,
      };
    }

    const planned = planDirectionalVocabSeriesTargets({
      candidates: candidates.map((candidate) => ({
        id: candidate.vocab_entry_id,
        eligibleDirections: ["korean_to_english"],
      })),
      distribution: "repeat",
      selectionMode: plan.selectionMode,
      sessionQuestionCounts: [requestedQuestionCount],
      englishToKoreanRatio: 0,
      seedScope: `${plan.planNonce}:${studentId}:canonical:${input.questionMode}`,
    })[0] ?? [];
    const candidateById = new Map(
      candidates.map((candidate) => [candidate.vocab_entry_id, candidate]),
    );
    const canonicalPlan = planned.flatMap((target) => {
      const candidate = candidateById.get(target.id);
      return candidate
        ? [{
            id: target.id,
            direction: "korean_to_english" as const,
            questionItemId: candidate.question_item_id,
            questionItemSha256: candidate.question_item_sha256,
            releaseId: candidate.release_id,
            packageSha256: candidate.package_sha256,
          }]
        : [];
    });
    if (canonicalPlan.length !== requestedQuestionCount) {
      return unavailableItem({
        studentId,
        studentName,
        datasetId: plan.datasetId,
        datasetLabel,
        message: "검수된 문제의 출제 순서를 확정하지 못했습니다.",
        field: "preview",
      });
    }
    targetPlansByStudent.set(studentId, [planned]);
    canonicalPlansByStudent.set(studentId, canonicalPlan);
    const unitIds = selectedUnits.map((unit) => unit.id);
    return {
      studentId,
      studentName,
      available: true,
      datasetId: plan.datasetId,
      datasetLabel,
      sessions: [{
        sessionNumber: 1,
        sourceSessionNumber: 1,
        cycleIndex: 0,
        available: true,
        unitId: unitIds[0] ?? null,
        unitLabel: unitSelectionLabel(selectedUnits),
        unitIds,
        unitLabels: selectedUnits.map((unit) => unit.label),
        rangeTruncated: false,
        questionCount: requestedQuestionCount,
        availableFrom: null,
        availableUntil: null,
        error: null,
      }],
      availableQuestionCount,
      selectedQuestionCount: requestedQuestionCount,
      remainingQuestionCount: availableQuestionCount - requestedQuestionCount,
      defaultSessionCount: 1,
      scheduledQuestionCount: requestedQuestionCount,
      requiresExtraDateDecision: false,
      error: null,
    };
  });

  const validPlans = [...canonicalPlansByStudent.values()];
  const releaseId = validPlans[0]?.[0]?.releaseId ?? null;
  const packageSha256 = validPlans[0]?.[0]?.packageSha256 ?? null;
  const assignmentCount = items.filter((item) => item.available).length;
  const preview: BulkAssignmentPreview = {
    items,
    assignableCount: assignmentCount,
    blockedCount: items.length - assignmentCount,
    assignmentCount,
    commonPlanSummary: null,
    planSignature: resolvedBulkPlanSha256(
      items.map((item) => ({
        studentId: item.studentId,
        datasetId: item.datasetId,
        sessions: item.sessions.map((session) => ({
          ...session,
          targets: (canonicalPlansByStudent.get(item.studentId) ?? []).map(
            (target) => ({
              id: target.id,
              direction: target.direction,
              questionItemId: target.questionItemId,
              questionItemSha256: target.questionItemSha256,
            }),
          ),
        })),
      })),
      {
        questionMode: input.questionMode,
        canonicalReleaseId: releaseId,
        canonicalPackageSha256: packageSha256,
        distribution: plan.distribution,
        splitBasis: plan.splitBasis,
        orderedUnitIds: plan.orderedUnitIds,
        rangeUnitCounts: plan.rangeUnitCounts,
        unitAllocationRule: plan.unitAllocationRule,
        questionCount: plan.questionCount,
        overflowPolicy: plan.overflowPolicy,
        extraDatePolicy: plan.extraDatePolicy,
        selectedDateCount: plan.selectedDateCount,
        selectionMode: plan.selectionMode,
        recurrenceSessions: plan.recurrenceSessions,
      },
    ),
    rangeLabel: selectedUnits.length > 0
      ? unitSelectionLabel(selectedUnits)
      : null,
  };
  return { preview, targetPlansByStudent, canonicalPlansByStudent };
}
