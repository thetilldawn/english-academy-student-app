import { commonText } from "@/content/ko/common";
import type { StudentDirectoryFilters } from "@/features/students/public-contracts";

function wrongWordFilterLabel(value: StudentDirectoryFilters["wrong"]) {
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
  filters: StudentDirectoryFilters;
  isWholeFilteredSelection: boolean;
}) {
  const query = filters.query.trim();
  const labels = [
    query ? `검색: ${query}` : null,
    filters.school || null,
    filters.grade || null,
    filters.wordbook || null,
    filters.classGroupId
      ? classGroupLabel ?? commonText.filters.byClassGroup
      : null,
    filters.status === "blocked" ? commonText.filters.blocked : null,
    wrongWordFilterLabel(filters.wrong),
  ].filter((label): label is string => Boolean(label));

  if (!isWholeFilteredSelection) return ["직접 선택"];
  if (labels.length > 0) return labels;
  return ["전체 학생"];
}
