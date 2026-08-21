type CountReference = {
  availableQuestionCount: number | null;
  selectedQuestionCount: number | null;
  remainingQuestionCount: number | null;
  defaultSessionCount: number | null;
};

type AudiencePreview = {
  items?: Array<
    CountReference & {
      available: boolean;
      error: string | null;
    }
  >;
  commonPlanSummary:
    | (CountReference & {
        normalStudentIds: string[];
        exceptionStudentIds: string[];
      })
    | null;
};

export type BulkPlanAudience = {
  mode: "empty" | "single" | "common" | "unresolved";
  reference: CountReference | null;
  separateCount: number;
  sameCount: number;
  totalCount: number;
};

export type BulkPlanItemStatus =
  | "same"
  | "different"
  | "needs_review"
  | "blocked"
  | "individual";

type StatusItem = {
  available: boolean;
  error: string | null;
  sessions: ReadonlyArray<{
    available: boolean;
    error: string | null;
    warnings: readonly unknown[];
  }>;
  studentId: string;
};

function completeReference(source: CountReference) {
  return source.availableQuestionCount !== null &&
    source.selectedQuestionCount !== null &&
    source.remainingQuestionCount !== null &&
    source.defaultSessionCount !== null;
}

export function buildBulkPlanAudience(
  preview: AudiencePreview | null | undefined,
): BulkPlanAudience {
  if (!preview) {
    return {
      mode: "empty",
      reference: null,
      separateCount: 0,
      sameCount: 0,
      totalCount: 0,
    };
  }
  if (preview.commonPlanSummary) {
    const totalCount =
      preview.items?.length ??
      preview.commonPlanSummary.normalStudentIds.length +
        preview.commonPlanSummary.exceptionStudentIds.length;
    if (totalCount === 1) {
      const complete = completeReference(preview.commonPlanSummary);
      return {
        mode: "single",
        reference: complete ? preview.commonPlanSummary : null,
        separateCount: complete ? 0 : 1,
        sameCount: complete ? 1 : 0,
        totalCount,
      };
    }
    if (preview.commonPlanSummary.normalStudentIds.length < 2) {
      return {
        mode: "unresolved",
        reference: null,
        separateCount: totalCount,
        sameCount: 0,
        totalCount,
      };
    }
    return {
      mode: "common",
      reference: preview.commonPlanSummary,
      separateCount: preview.commonPlanSummary.exceptionStudentIds.length,
      sameCount: preview.commonPlanSummary.normalStudentIds.length,
      totalCount,
    };
  }
  const items = preview.items ?? [];
  if (items.length === 1) {
    const item = items[0]!;
    const common = item.available && !item.error && completeReference(item);
    return {
      mode: "single",
      reference: common ? item : null,
      separateCount: common ? 0 : 1,
      sameCount: common ? 1 : 0,
      totalCount: 1,
    };
  }
  return {
    mode: "unresolved",
    reference: null,
    separateCount: items.length,
    sameCount: 0,
    totalCount: items.length,
  };
}

export function bulkPlanItemStatus(
  item: StatusItem,
  normalStudentIds?: ReadonlySet<string>,
): BulkPlanItemStatus {
  if (
    !item.available ||
    Boolean(item.error) ||
    item.sessions.length === 0 ||
    item.sessions.some((session) => !session.available || Boolean(session.error))
  ) {
    return "blocked";
  }
  if (item.sessions.some((session) => session.warnings.length > 0)) {
    return "needs_review";
  }
  if (!normalStudentIds) return "individual";
  return normalStudentIds.has(item.studentId) ? "same" : "different";
}
