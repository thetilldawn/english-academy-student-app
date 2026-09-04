import "server-only";

import type { AdminContext } from "@/lib/auth/admin";
import {
  createRegularAssignmentPreparationCache,
  loadRegularAssignmentSeriesCandidates,
  prepareRegularAssignment,
  type PreparedRegularAssignment,
  type RegularAssignmentPreparationCache,
} from "@/lib/services/regular-assignment-service";

import type {
  BulkAssignmentInput,
  BulkAssignmentPreviewInput,
} from "../../contracts/bulk-assignment-request";
import type { BulkAssignmentPreviewSession } from "../../contracts/bulk-assignment-response";
import type { PlannedVocabSeriesTarget } from "../../domain/vocab-assignment-contract";
import {
  rebalanceHalfRatioSplitQuestionCounts,
} from "../../domain/vocab-question-allocation";
import { planDirectionalVocabSeriesTargets } from "../../domain/vocab-series-target-planner";
import { BulkAssignmentError } from "./bulk-assignment-errors";

export type BulkAssignmentPreparationContext = {
  regular: RegularAssignmentPreparationCache;
};

export type CommonPlanInput = NonNullable<
  BulkAssignmentPreviewInput["commonPlan"]
>;

export function createBulkAssignmentPreparationContext(): BulkAssignmentPreparationContext {
  return {
    regular: createRegularAssignmentPreparationCache(),
  };
}

export async function mapInBatches<Input, Output>(
  items: readonly Input[],
  batchSize: number,
  mapper: (item: Input) => Promise<Output>,
) {
  const results: Output[] = [];
  for (let index = 0; index < items.length; index += batchSize) {
    results.push(
      ...await Promise.all(items.slice(index, index + batchSize).map(mapper)),
    );
  }
  return results;
}

function includesAssignmentSettings(
  request: BulkAssignmentPreviewInput,
): request is BulkAssignmentInput {
  return "passingScore" in request;
}

export async function prepareCommonPlanSeries(input: {
  request: BulkAssignmentPreviewInput;
  commonPlan: CommonPlanInput;
  studentId: string;
  datasetId: string;
  availableQuestionCount: number;
  maximumSessionQuestionCount?: number;
  sessions: readonly BulkAssignmentPreviewSession[];
  admin: AdminContext;
  cache: RegularAssignmentPreparationCache;
  materializeQuestions: boolean;
}): Promise<{
  preparedSeries: PreparedRegularAssignment[];
  sessionQuestionCounts: number[];
  sessionTargets: PlannedVocabSeriesTarget[][];
}> {
  const {
    request,
    commonPlan,
    studentId,
    datasetId,
    availableQuestionCount,
    maximumSessionQuestionCount = 500,
    sessions,
    admin,
    cache,
    materializeQuestions,
  } = input;
  const assignmentSettings = includesAssignmentSettings(request)
    ? {
        timeLimitSeconds: request.timeLimitSeconds,
        timingMode: request.timingMode,
        questionTimeLimitSeconds: request.questionTimeLimitSeconds,
        passingScore: request.passingScore,
        retryEnabled: request.retryEnabled,
        retryPassingScore: request.retryPassingScore,
        questionOrderMode: request.questionOrderMode,
      }
    : {
        timeLimitSeconds: 900,
        timingMode: "total" as const,
        questionTimeLimitSeconds: null,
        passingScore: 80,
        retryEnabled: true,
        retryPassingScore: 80,
        questionOrderMode: "ascending" as const,
      };
  const firstSession = sessions[0];
  if (
    availableQuestionCount < 1 ||
    !firstSession ||
    sessions.some(
      (session) => session.unitIds.length < 1 || session.questionCount < 1,
    )
  ) {
    throw new BulkAssignmentError("invalid_selection");
  }
  if (commonPlan.splitBasis === "range_unit") {
    const sessionQuestionCounts = sessions.map((session) => session.questionCount);
    const plannedTargets: ReturnType<typeof planDirectionalVocabSeriesTargets> = [];
    for (const session of sessions) {
      const candidates = await loadRegularAssignmentSeriesCandidates(
        {
          datasetId,
          unitIds: session.unitIds,
          studentIds: [studentId],
        },
        admin,
        cache,
      );
      const targets = planDirectionalVocabSeriesTargets({
        candidates,
        distribution: "repeat",
        selectionMode: commonPlan.selectionMode,
        sessionQuestionCounts: [session.questionCount],
        englishToKoreanRatio: request.englishToKoreanRatio,
        seedScope:
          `${commonPlan.planNonce}:${studentId}:unit:${session.sourceSessionNumber}:cycle:${session.cycleIndex}`,
      })[0] ?? [];
      if (targets.length !== session.questionCount) {
        throw new BulkAssignmentError(
          "invalid_selection",
          `${session.sessionNumber}회차 범위 안에서 단어 수와 시험 방식을 함께 적용할 수 없습니다.`,
        );
      }
      plannedTargets.push(targets);
    }

    const preparedSeries: PreparedRegularAssignment[] = [];
    if (!materializeQuestions) {
      return {
        preparedSeries,
        sessionQuestionCounts,
        sessionTargets: plannedTargets,
      };
    }
    for (const [index, session] of sessions.entries()) {
      const exactTargets = plannedTargets[index]!;
      preparedSeries.push(await prepareRegularAssignment(
        {
          title: "",
          datasetId,
          unitIds: session.unitIds,
          questionCount: sessionQuestionCounts[index]!,
          englishToKoreanRatio: request.englishToKoreanRatio,
          ...assignmentSettings,
          availableUntil: session.availableUntil,
          studentIds: [studentId],
          targetSelectionMode: commonPlan.selectionMode,
          randomSeed:
            `${commonPlan.planNonce}:${studentId}:unit:${session.sourceSessionNumber}`,
          exactTargetIds: exactTargets.map((target) => target.id),
          exactTargetDirections: exactTargets.map((target) => target.direction),
        },
        admin,
        undefined,
        cache,
      ));
    }
    return {
      preparedSeries,
      sessionQuestionCounts,
      sessionTargets: plannedTargets,
    };
  }
  const targetEligibility = await loadRegularAssignmentSeriesCandidates(
    {
      datasetId,
      unitIds: firstSession.unitIds,
      studentIds: [studentId],
    },
    admin,
    cache,
  );
  const sessionQuestionCounts = sessions.map((session) => session.questionCount);
  const planTargetIds = (
    counts: readonly number[],
    cycleIndex: number | null,
  ) =>
    planDirectionalVocabSeriesTargets({
      candidates: targetEligibility,
      distribution: commonPlan.distribution,
      selectionMode: commonPlan.selectionMode,
      sessionQuestionCounts: counts,
      englishToKoreanRatio: request.englishToKoreanRatio,
      seedScope: cycleIndex === null
        ? `${commonPlan.planNonce}:${studentId}:series`
        : `${commonPlan.planNonce}:${studentId}:cycle:${cycleIndex}`,
    });
  const cycleGroups: Array<{
    start: number;
    end: number;
    cycleIndex: number | null;
  }> = [];
  if (commonPlan.distribution === "split") {
    let start = 0;
    while (start < sessions.length) {
      const cycleIndex = sessions[start]!.cycleIndex;
      let end = start + 1;
      while (
        end < sessions.length &&
        sessions[end]!.cycleIndex === cycleIndex
      ) {
        end += 1;
      }
      cycleGroups.push({ start, end, cycleIndex });
      start = end;
    }
  } else {
    cycleGroups.push({ start: 0, end: sessions.length, cycleIndex: null });
  }
  const plannedTargets: ReturnType<typeof planDirectionalVocabSeriesTargets> = [];
  for (const group of cycleGroups) {
    let groupCounts = sessionQuestionCounts.slice(group.start, group.end);
    let groupTargets = planTargetIds(groupCounts, group.cycleIndex);
    if (
      groupTargets.length !== groupCounts.length &&
      commonPlan.distribution === "split" &&
      request.englishToKoreanRatio === 50
    ) {
      const maximumQuestionCount = commonPlan.questionCount.mode === "manual"
        ? Math.min(
            commonPlan.questionCount.value,
            maximumSessionQuestionCount,
          )
        : maximumSessionQuestionCount;
      const adjustedCounts = rebalanceHalfRatioSplitQuestionCounts(
        groupCounts,
        maximumQuestionCount,
      );
      if (adjustedCounts) {
        const adjustedTargets = planTargetIds(
          adjustedCounts,
          group.cycleIndex,
        );
        if (adjustedTargets.length === groupCounts.length) {
          groupCounts = adjustedCounts;
          groupTargets = adjustedTargets;
        }
      }
    }
    sessionQuestionCounts.splice(
      group.start,
      group.end - group.start,
      ...groupCounts,
    );
    plannedTargets.push(...groupTargets);
  }
  if (
    plannedTargets.length !== sessions.length ||
    plannedTargets.some(
      (targets, index) =>
        targets.length !== sessionQuestionCounts[index],
    )
  ) {
    throw new BulkAssignmentError(
      "invalid_selection",
      "전체 회차에서 단어 수와 시험 방식을 함께 적용할 수 없습니다.",
    );
  }

  const preparedSeries: PreparedRegularAssignment[] = [];
  if (!materializeQuestions) {
    return {
      preparedSeries,
      sessionQuestionCounts,
      sessionTargets: plannedTargets,
    };
  }
  for (const [index, session] of sessions.entries()) {
    const exactTargets = plannedTargets[index]!;
    preparedSeries.push(await prepareRegularAssignment(
      {
        title: "",
        datasetId,
        unitIds: session.unitIds,
        questionCount: sessionQuestionCounts[index]!,
        englishToKoreanRatio: request.englishToKoreanRatio,
        ...assignmentSettings,
        availableUntil: session.availableUntil,
        studentIds: [studentId],
        targetSelectionMode: commonPlan.selectionMode,
        randomSeed:
          `${commonPlan.planNonce}:${studentId}:${session.sourceSessionNumber}`,
        exactTargetIds: exactTargets.map((target) => target.id),
        exactTargetDirections: exactTargets.map((target) => target.direction),
      },
      admin,
      undefined,
      cache,
    ));
  }
  return {
    preparedSeries,
    sessionQuestionCounts,
    sessionTargets: plannedTargets,
  };
}
