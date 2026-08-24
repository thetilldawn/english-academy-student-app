import { commonText } from "@/content/ko/common";

type BulkStudentFilters = {
  classGroup: string;
  grade: string;
  query: string;
  school: string;
  status: "active" | "blocked";
  wordbook: string;
  wrongWord: "all" | "wrong" | "repeated" | "retry";
};

function wrongWordFilterLabel(value: BulkStudentFilters["wrongWord"]) {
  if (value === "wrong") return commonText.filters.hasWrong;
  if (value === "repeated") return commonText.filters.repeatedWrong;
  if (value === "retry") return commonText.filters.retryNeeded;
  return null;
}

export function buildBulkStudentFilterLabels({
  classGroupLabel,
  filters,
  isWholeFilteredSelection,
}: {
  classGroupLabel: string | null;
  filters: BulkStudentFilters;
  isWholeFilteredSelection: boolean;
}) {
  const query = filters.query.trim();
  const labels = [
    query ? `검색: ${query}` : null,
    filters.school || null,
    filters.grade || null,
    filters.wordbook || null,
    filters.classGroup
      ? classGroupLabel ?? commonText.filters.byClassGroup
      : null,
    filters.status === "blocked" ? commonText.filters.blocked : null,
    wrongWordFilterLabel(filters.wrongWord),
  ].filter((label): label is string => Boolean(label));

  if (labels.length > 0) return labels;
  return [isWholeFilteredSelection ? "전체 학생" : "직접 선택"];
}
