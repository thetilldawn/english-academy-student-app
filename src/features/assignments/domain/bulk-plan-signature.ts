export type BulkPlanSignatureSource = {
  datasetId: string | null;
  availableQuestionCount: number | null;
  selectedQuestionCount: number | null;
  remainingQuestionCount: number | null;
  defaultSessionCount: number | null;
  scheduledQuestionCount: number | null;
  requiresExtraDateDecision: boolean;
  sessions: ReadonlyArray<{
    availableFrom: string;
    availableUntil: string | null;
    questionCount: number;
    cycleIndex: number;
    unitIds: readonly string[];
    unitLabel: string | null;
  }>;
};

export function bulkPlanSignature(item: BulkPlanSignatureSource) {
  return JSON.stringify({
    datasetId: item.datasetId,
    availableQuestionCount: item.availableQuestionCount,
    selectedQuestionCount: item.selectedQuestionCount,
    remainingQuestionCount: item.remainingQuestionCount,
    defaultSessionCount: item.defaultSessionCount,
    scheduledQuestionCount: item.scheduledQuestionCount,
    requiresExtraDateDecision: item.requiresExtraDateDecision,
    sessions: item.sessions.map((session) => ({
      availableFrom: session.availableFrom,
      availableUntil: session.availableUntil,
      questionCount: session.questionCount,
      cycleIndex: session.cycleIndex,
      unitIds: [...session.unitIds],
      unitLabel: session.unitLabel,
    })),
  });
}
