import type {
  StudentWrongWordHistory,
  WrongWordAggregate,
} from "@/lib/admin/wrong-word-history";

export type WrongWordLevelFilter = "all" | "once" | "repeated";
export type WrongWordSelectionPurpose = "next_exam" | "worksheet";

export type WrongWordSelectionTarget = {
  questionId: string;
  resolution: "unresolved" | "resolved";
  scheduling?: "available" | "queued" | "assigned" | "none";
  activeAssignment?: WrongWordAggregate["activeAssignment"];
};

function wordMatchesQuery(
  query: string,
  values: Array<string | null | undefined>,
) {
  const keyword = query.trim().toLocaleLowerCase("ko-KR");
  if (!keyword) return true;
  return values
    .filter(Boolean)
    .join(" ")
    .toLocaleLowerCase("ko-KR")
    .includes(keyword);
}

function candidateOccurrences(word: WrongWordAggregate, datasetId: string) {
  return datasetId
    ? word.occurrences.filter((candidate) => candidate.datasetId === datasetId)
    : word.occurrences;
}

export function selectNextExamWrongWordTarget(
  word: WrongWordAggregate,
  datasetId: string,
): WrongWordSelectionTarget | null {
  const candidates = candidateOccurrences(word, datasetId);
  const occurrence =
    candidates.find(
      (candidate) =>
        candidate.resolution === "unresolved" &&
        candidate.scheduling === "assigned",
    ) ??
    candidates.find(
      (candidate) =>
        candidate.resolution === "unresolved" &&
        candidate.scheduling === "queued",
    ) ??
    candidates.find(
      (candidate) =>
        candidate.resolution === "unresolved" &&
        candidate.scheduling === "available",
    ) ??
    candidates.find((candidate) => candidate.resolution === "unresolved") ??
    candidates.find(
      (candidate) =>
        candidate.datasetId === word.latestDatasetId &&
        candidate.vocabEntryId === word.latestVocabEntryId,
    ) ??
    candidates[0];
  if (!occurrence) return null;
  return {
    questionId: occurrence.latestQuestionId,
    resolution: occurrence.resolution,
    scheduling: occurrence.scheduling,
    activeAssignment: occurrence.activeAssignment,
  };
}

export function selectWorksheetWrongWordTarget(
  word: WrongWordAggregate,
  datasetId: string,
): WrongWordSelectionTarget | null {
  const occurrence = candidateOccurrences(word, datasetId).find(
    (candidate) => candidate.resolution === "unresolved",
  );
  return occurrence
    ? {
        questionId: occurrence.latestQuestionId,
        resolution: occurrence.resolution,
      }
    : null;
}

export function wrongWordDatasetOptions(
  history: StudentWrongWordHistory | null,
) {
  const labelById = new Map<string, string>();
  for (const word of history?.words ?? []) {
    for (const occurrence of word.occurrences) {
      if (!labelById.has(occurrence.datasetId)) {
        labelById.set(occurrence.datasetId, occurrence.datasetLabel);
      }
    }
  }
  return [...labelById.entries()]
    .map(([id, label]) => ({ id, label }))
    .toSorted((left, right) => left.label.localeCompare(right.label, "ko-KR"));
}

export function activeWrongWordReviewDrafts(
  history: StudentWrongWordHistory | null,
) {
  const activeDrafts = new Map<
    string,
    { datasetId: string; draftId: string; questionIds: string[] }
  >();
  for (const review of history?.pendingReviews ?? []) {
    if (!review.reviewDraftId) continue;
    const current = activeDrafts.get(review.reviewDraftId) ?? {
      datasetId: review.datasetId,
      draftId: review.reviewDraftId,
      questionIds: [],
    };
    current.questionIds.push(review.sourceQuestionId);
    activeDrafts.set(review.reviewDraftId, current);
  }
  return [...activeDrafts.values()];
}

export function filterWrongWords(input: {
  history: StudentWrongWordHistory | null;
  datasetId: string;
  level: WrongWordLevelFilter;
  query: string;
}) {
  return (input.history?.words ?? []).filter((word) => {
    const levelMatches =
      input.level === "all" ||
      (input.level === "once" && word.wrongLevel === 1) ||
      (input.level === "repeated" && word.wrongLevel === 2);
    const datasetMatches =
      !input.datasetId ||
      word.occurrences.some(
        (occurrence) => occurrence.datasetId === input.datasetId,
      );
    return levelMatches && datasetMatches && wordMatchesQuery(input.query, [
      word.headword,
      word.primaryMeaning,
      ...word.occurrences.map((occurrence) => occurrence.datasetLabel),
    ]);
  });
}

export function selectableWrongWordQuestionIds(input: {
  words: readonly WrongWordAggregate[];
  datasetId: string;
  purpose: WrongWordSelectionPurpose;
}) {
  return input.words.flatMap((word) => {
    const target = input.purpose === "next_exam"
      ? selectNextExamWrongWordTarget(word, input.datasetId)
      : selectWorksheetWrongWordTarget(word, input.datasetId);
    if (!target) return [];
    if (
      input.purpose === "next_exam" &&
      (target.resolution !== "unresolved" || target.scheduling !== "available")
    ) {
      return [];
    }
    return [target.questionId];
  });
}

export function keepSelectableQuestionIds(
  selectedQuestionIds: readonly string[],
  selectableQuestionIds: readonly string[],
) {
  const selectable = new Set(selectableQuestionIds);
  return selectedQuestionIds.filter((questionId) => selectable.has(questionId));
}
