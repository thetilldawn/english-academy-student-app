export type StudentCurrentVocabWrongSummary = {
  studentId: string;
  datasetId: string;
  wrongWordCount: number;
  repeatedWrongWordCount: number;
};

export type CurrentVocabWrongSummaryRow = {
  student_id: unknown;
  dataset_id: unknown;
  wrong_word_count: unknown;
  repeated_wrong_word_count: unknown;
};

export type CurrentVocabWrongCounts = Omit<
  StudentCurrentVocabWrongSummary,
  "studentId" | "datasetId"
>;

export function currentVocabWrongSummaryKey(
  studentId: string,
  datasetId: string,
) {
  return `${studentId}:${datasetId}`;
}

function parseCount(value: unknown) {
  const count =
    typeof value === "number"
      ? value
      : typeof value === "string" && value.trim()
        ? Number(value)
        : Number.NaN;
  if (!Number.isSafeInteger(count) || count < 0) {
    throw new Error("오답 단어 수치가 올바르지 않습니다.");
  }
  return count;
}

export function parseStudentCurrentVocabWrongSummaries(
  rows: readonly CurrentVocabWrongSummaryRow[],
): StudentCurrentVocabWrongSummary[] {
  return rows.map((row) => {
    if (
      typeof row.student_id !== "string" ||
      typeof row.dataset_id !== "string"
    ) {
      throw new Error("오답 학생·단어장 정보가 올바르지 않습니다.");
    }
    const summary: StudentCurrentVocabWrongSummary = {
      studentId: row.student_id,
      datasetId: row.dataset_id,
      wrongWordCount: parseCount(row.wrong_word_count),
      repeatedWrongWordCount: parseCount(
        row.repeated_wrong_word_count,
      ),
    };
    if (summary.repeatedWrongWordCount > summary.wrongWordCount) {
      throw new Error(
        "반복 오답 단어 수가 전체 오답 단어 수보다 많습니다.",
      );
    }
    return summary;
  });
}

export function emptyCurrentVocabWrongCounts(): CurrentVocabWrongCounts {
  return {
    wrongWordCount: 0,
    repeatedWrongWordCount: 0,
  };
}

export function indexStudentCurrentVocabWrongSummaries(
  summaries: readonly StudentCurrentVocabWrongSummary[],
) {
  const byStudentDataset = new Map<
    string,
    CurrentVocabWrongCounts
  >();

  for (const summary of summaries) {
    const key = currentVocabWrongSummaryKey(
      summary.studentId,
      summary.datasetId,
    );
    if (byStudentDataset.has(key)) {
      throw new Error("중복된 학생·단어장 오답 요약이 있습니다.");
    }
    byStudentDataset.set(key, {
      wrongWordCount: summary.wrongWordCount,
      repeatedWrongWordCount: summary.repeatedWrongWordCount,
    });
  }

  return { byStudentDataset };
}
