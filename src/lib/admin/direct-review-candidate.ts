export type DirectReviewDatasetSummary = {
  datasetId: string;
  level1Count: number;
  level2Count: number;
  totalCount: number;
  latestWrongAt: string | null;
};

export type DirectReviewCandidate = {
  sourceQuestionId: string;
  datasetId: string;
  vocabEntryId: number;
  canonicalDictionaryId: string | null;
  canonicalLexemeId: string | null;
  headwordNormalized: string;
  reasonLevel: 1 | 2;
  wrongCount: number;
  lastWrongAt: string | null;
};

export type DirectReviewDatasetSummaryRow = {
  dataset_id: unknown;
  level_1_count: unknown;
  level_2_count: unknown;
  total_count: unknown;
  latest_wrong_at: unknown;
};

export type DirectReviewCandidateRow = {
  source_question_id: unknown;
  dataset_id: unknown;
  vocab_entry_id: unknown;
  canonical_dictionary_id: unknown;
  canonical_lexeme_id: unknown;
  headword_normalized: unknown;
  reason_level: unknown;
  wrong_count: unknown;
  last_wrong_at: unknown;
};

function nonNegativeInteger(value: unknown, label: string) {
  const parsed = typeof value === "number"
    ? value
    : typeof value === "string" && value.trim()
      ? Number(value)
      : Number.NaN;
  if (!Number.isSafeInteger(parsed) || parsed < 0) {
    throw new Error(`${label} 수치가 올바르지 않습니다.`);
  }
  return parsed;
}

function nullableString(value: unknown, label: string) {
  if (value === null) return null;
  if (typeof value !== "string" || !value.trim()) {
    throw new Error(`${label} 정보가 올바르지 않습니다.`);
  }
  return value;
}

export function parseDirectReviewDatasetSummaries(
  rows: readonly DirectReviewDatasetSummaryRow[],
): DirectReviewDatasetSummary[] {
  return rows.map((row) => {
    if (typeof row.dataset_id !== "string" || !row.dataset_id) {
      throw new Error("오답 단어장 정보가 올바르지 않습니다.");
    }
    const level1Count = nonNegativeInteger(row.level_1_count, "1회 오답");
    const level2Count = nonNegativeInteger(row.level_2_count, "반복 오답");
    const totalCount = nonNegativeInteger(row.total_count, "전체 오답");
    if (level1Count + level2Count !== totalCount) {
      throw new Error("오답 단계별 합계가 전체 오답 수와 다릅니다.");
    }
    return {
      datasetId: row.dataset_id,
      level1Count,
      level2Count,
      totalCount,
      latestWrongAt: nullableString(row.latest_wrong_at, "최근 오답 시각"),
    };
  });
}

export function parseDirectReviewCandidates(
  rows: readonly DirectReviewCandidateRow[],
): DirectReviewCandidate[] {
  const result = rows.map((row): DirectReviewCandidate => {
    if (
      typeof row.source_question_id !== "string" ||
      typeof row.dataset_id !== "string" ||
      typeof row.headword_normalized !== "string"
    ) {
      throw new Error("독립 오답 시험 후보 정보가 올바르지 않습니다.");
    }
    const vocabEntryId = nonNegativeInteger(row.vocab_entry_id, "단어 ID");
    const reasonLevel = nonNegativeInteger(row.reason_level, "틀린 횟수 단계");
    const wrongCount = nonNegativeInteger(row.wrong_count, "틀린 횟수");
    if ((reasonLevel !== 1 && reasonLevel !== 2) || wrongCount < reasonLevel) {
      throw new Error("틀린 횟수 단계가 올바르지 않습니다.");
    }
    return {
      sourceQuestionId: row.source_question_id,
      datasetId: row.dataset_id,
      vocabEntryId,
      canonicalDictionaryId: nullableString(
        row.canonical_dictionary_id,
        "사전 단어",
      ),
      canonicalLexemeId: nullableString(
        row.canonical_lexeme_id,
        "표제어",
      ),
      headwordNormalized: row.headword_normalized,
      reasonLevel,
      wrongCount,
      lastWrongAt: nullableString(row.last_wrong_at, "최근 오답 시각"),
    };
  });
  if (new Set(result.map((candidate) => candidate.sourceQuestionId)).size !== result.length) {
    throw new Error("같은 오답 단어가 후보에 중복되었습니다.");
  }
  return result;
}

export function indexDirectReviewDatasetSummaries(
  summaries: readonly DirectReviewDatasetSummary[],
) {
  const byDatasetId = new Map<string, DirectReviewDatasetSummary>();
  for (const summary of summaries) {
    if (byDatasetId.has(summary.datasetId)) {
      throw new Error("같은 단어장의 오답 요약이 중복되었습니다.");
    }
    byDatasetId.set(summary.datasetId, summary);
  }
  return byDatasetId;
}
