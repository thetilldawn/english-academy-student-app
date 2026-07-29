export type StudentPendingReviewSummary = {
  studentId: string;
  datasetId: string;
  pendingLevel1Count: number;
  pendingLevel2Count: number;
  reservedLevel1Count: number;
  reservedLevel2Count: number;
};

export type PendingReviewSummaryRow = {
  student_id: unknown;
  dataset_id: unknown;
  pending_level_1_count: unknown;
  pending_level_2_count: unknown;
  reserved_level_1_count: unknown;
  reserved_level_2_count: unknown;
};

export type PendingReviewCounts = Omit<
  StudentPendingReviewSummary,
  "studentId" | "datasetId"
>;

export type PendingReviewSummaryIndex = {
  byStudentDataset: Map<string, PendingReviewCounts>;
  byStudent: Map<string, PendingReviewCounts>;
};

export function pendingReviewSummaryKey(
  studentId: string,
  datasetId: string,
) {
  return `${studentId}:${datasetId}`;
}

function reviewCount(value: unknown) {
  const count =
    typeof value === "number"
      ? value
      : typeof value === "string" && value.trim()
        ? Number(value)
        : Number.NaN;
  if (!Number.isSafeInteger(count) || count < 0) {
    throw new Error("오답 대기 수치가 올바르지 않습니다.");
  }
  return count;
}

export function parseStudentPendingReviewSummaries(
  rows: readonly PendingReviewSummaryRow[],
): StudentPendingReviewSummary[] {
  return rows.map((row) => {
    if (
      typeof row.student_id !== "string" ||
      typeof row.dataset_id !== "string"
    ) {
      throw new Error("오답 대기 학생·단어장 정보가 올바르지 않습니다.");
    }
    const summary: StudentPendingReviewSummary = {
      studentId: row.student_id,
      datasetId: row.dataset_id,
      pendingLevel1Count: reviewCount(row.pending_level_1_count),
      pendingLevel2Count: reviewCount(row.pending_level_2_count),
      reservedLevel1Count: reviewCount(row.reserved_level_1_count),
      reservedLevel2Count: reviewCount(row.reserved_level_2_count),
    };
    if (
      summary.reservedLevel1Count > summary.pendingLevel1Count ||
      summary.reservedLevel2Count > summary.pendingLevel2Count
    ) {
      throw new Error("예약된 오답 수가 전체 대기 수보다 많습니다.");
    }
    return summary;
  });
}

export function emptyPendingReviewCounts(): PendingReviewCounts {
  return {
    pendingLevel1Count: 0,
    pendingLevel2Count: 0,
    reservedLevel1Count: 0,
    reservedLevel2Count: 0,
  };
}

function mergePendingReviewCounts(
  left: PendingReviewCounts,
  right: PendingReviewCounts,
): PendingReviewCounts {
  return {
    pendingLevel1Count:
      left.pendingLevel1Count + right.pendingLevel1Count,
    pendingLevel2Count:
      left.pendingLevel2Count + right.pendingLevel2Count,
    reservedLevel1Count:
      left.reservedLevel1Count + right.reservedLevel1Count,
    reservedLevel2Count:
      left.reservedLevel2Count + right.reservedLevel2Count,
  };
}

export function indexStudentPendingReviewSummaries(
  summaries: readonly StudentPendingReviewSummary[],
): PendingReviewSummaryIndex {
  const byStudentDataset = new Map<string, PendingReviewCounts>();
  const byStudent = new Map<string, PendingReviewCounts>();

  for (const summary of summaries) {
    const counts: PendingReviewCounts = {
      pendingLevel1Count: summary.pendingLevel1Count,
      pendingLevel2Count: summary.pendingLevel2Count,
      reservedLevel1Count: summary.reservedLevel1Count,
      reservedLevel2Count: summary.reservedLevel2Count,
    };
    const key = pendingReviewSummaryKey(
      summary.studentId,
      summary.datasetId,
    );
    byStudentDataset.set(
      key,
      mergePendingReviewCounts(
        byStudentDataset.get(key) ?? emptyPendingReviewCounts(),
        counts,
      ),
    );
    byStudent.set(
      summary.studentId,
      mergePendingReviewCounts(
        byStudent.get(summary.studentId) ??
          emptyPendingReviewCounts(),
        counts,
      ),
    );
  }

  return { byStudentDataset, byStudent };
}

export function pendingReviewCount(
  counts: PendingReviewCounts,
  levels: readonly (1 | 2)[] = [1, 2],
) {
  return levels.reduce(
    (total, level) =>
      total +
      (level === 1
        ? counts.pendingLevel1Count
        : counts.pendingLevel2Count),
    0,
  );
}

export function reservedReviewCount(
  counts: PendingReviewCounts,
  levels: readonly (1 | 2)[] = [1, 2],
) {
  return levels.reduce(
    (total, level) =>
      total +
      (level === 1
        ? counts.reservedLevel1Count
        : counts.reservedLevel2Count),
    0,
  );
}

export function availableReviewCount(
  counts: PendingReviewCounts,
  levels: readonly (1 | 2)[] = [1, 2],
) {
  return pendingReviewCount(counts, levels) -
    reservedReviewCount(counts, levels);
}
