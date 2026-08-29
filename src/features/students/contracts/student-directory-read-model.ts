export const studentDirectoryStatuses = [
  "all",
  "active",
  "blocked",
] as const;

export const studentDirectoryWrongFilters = [
  "all",
  "wrong",
  "repeated",
  "retry",
] as const;

export type StudentDirectoryStatus =
  (typeof studentDirectoryStatuses)[number];
export type StudentDirectoryWrongFilter =
  (typeof studentDirectoryWrongFilters)[number];

export type StudentDirectoryFilters = {
  classGroupId: string;
  grade: string;
  query: string;
  school: string;
  status: StudentDirectoryStatus;
  wordbook: string;
  wrong: StudentDirectoryWrongFilter;
};

export const emptyStudentDirectoryFilters: StudentDirectoryFilters = {
  classGroupId: "",
  grade: "",
  query: "",
  school: "",
  status: "all",
  wordbook: "",
  wrong: "all",
};

export type StudentDirectoryListItem = {
  codeStatus: "active" | "blocked" | "expired" | "missing";
  completedCount: number;
  currentVocabBook: string | null;
  displayName: string;
  gradeLabel: string | null;
  id: string;
  missedCount: number;
  notStartedCount: number;
  rawPoints: number;
  recentExamAt: string | null;
  schoolName: string | null;
  status: "active" | "blocked";
};

export type StudentDirectoryFilterOptions = {
  classGroups: Array<{ id: string; name: string }>;
  grades: string[];
  schools: string[];
  wordbooks: string[];
};

export type StudentDirectoryPage = {
  items: StudentDirectoryListItem[];
  nextCursor: string | null;
};

export type StudentDirectorySnapshot = {
  filterOptions: StudentDirectoryFilterOptions;
  filters: StudentDirectoryFilters;
  page: StudentDirectoryPage;
  snapshotAt: string;
  totalCount: number;
};

export type StudentDirectoryInitialRequest = {
  filters: StudentDirectoryFilters;
  mode: "initial";
};

export type StudentDirectoryPageRequest = {
  cursor: string;
  filters: StudentDirectoryFilters;
  mode: "page";
};

export type StudentDirectoryReadRequest =
  | StudentDirectoryInitialRequest
  | StudentDirectoryPageRequest;

function compactText(value: string, limit: number) {
  return value.replace(/\s+/gu, " ").trim().slice(0, limit);
}
export function normalizeStudentDirectoryFilters(
  filters: StudentDirectoryFilters,
): StudentDirectoryFilters {
  return {
    classGroupId: filters.classGroupId.trim(),
    grade: compactText(filters.grade, 40),
    query: compactText(filters.query, 80),
    school: compactText(filters.school, 120),
    status: studentDirectoryStatuses.includes(filters.status)
      ? filters.status
      : "all",
    wordbook: compactText(filters.wordbook, 160),
    wrong: studentDirectoryWrongFilters.includes(filters.wrong)
      ? filters.wrong
      : "all",
  };
}
