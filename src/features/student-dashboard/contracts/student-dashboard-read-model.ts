export const studentDashboardSectionKeys = [
  "open",
  "scheduled",
  "needs_attention",
  "completed",
  "deadline_closed",
] as const;

export type StudentDashboardSectionKey =
  (typeof studentDashboardSectionKeys)[number];

export type StudentDashboardCurrentSectionKey = Exclude<
  StudentDashboardSectionKey,
  "completed"
>;

export type StudentAssignmentSummary = {
  id: string;
  assignmentStatus: "draft" | "active" | "closed";
  displayTitle: string;
  datasetTitle: string;
  assignmentPurpose: "regular" | "review" | "mixed";
  scopeLabel: string;
  questionCount: number;
  passingScore: number;
  retakeAllowed: boolean;
  lastAttemptId: string | null;
  lastStatus: "in_progress" | "completed" | "expired" | null;
  lastPhase: "initial" | "review" | "retry" | "completed" | null;
  lastInitialScore: number | null;
  lastFinalScore: number | null;
  lastPassed: boolean | null;
  lastRetryStartedAt: string | null;
  lastStartedAt: string | null;
  lastInitialCompletedAt: string | null;
  lastCompletedAt: string | null;
  lastDeadlineAt: string | null;
  lastUnresolvedWrongCount: number | null;
  assignedAt: string;
  availableFrom: string | null;
  availableUntil: string | null;
  missedAt: string | null;
};

export type StudentDashboardSectionCounts = Record<
  StudentDashboardSectionKey,
  number
>;

export type StudentDashboardCurrentNode = {
  assignment: StudentAssignmentSummary;
  section: StudentDashboardCurrentSectionKey;
};

export type StudentDashboardCompletedPage = {
  items: StudentAssignmentSummary[];
  nextCursor: string | null;
};

export type StudentDashboardInitialSnapshot = {
  completedPage: StudentDashboardCompletedPage;
  currentAssignments: StudentDashboardCurrentNode[];
  sectionCounts: StudentDashboardSectionCounts;
  snapshotAt: string;
};

export type StudentDashboardCompletedPageResponse = {
  page: StudentDashboardCompletedPage;
};

