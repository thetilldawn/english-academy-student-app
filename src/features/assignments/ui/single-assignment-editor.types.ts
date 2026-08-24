import type {
  AssignmentDatasetItem,
  AssignmentProgressItem,
  AssignmentStudentItem,
  AssignmentUnitItem,
} from "../catalog-types";
import type { SingleAssignmentResult } from "../controller/use-assignment-controller";

export type SingleAssignmentSubmitPresentation = {
  blockedReason: string | null;
  canSubmit: boolean;
  formId: string;
  label: string;
};

export type SingleAssignmentEditorProps = {
  availableReviewLevel1: number;
  availableReviewLevel2: number;
  datasets: readonly AssignmentDatasetItem[];
  editTarget: {
    assignmentId: string;
    purpose: "regular" | "mixed" | "review";
    studentId: string;
  } | null;
  formId?: string;
  initialDatasetId: string;
  initialUnitIds?: readonly string[];
  onBusyChange?: (busy: boolean) => void;
  onConflict?: () => void;
  onSubmitPresentationChange?: (
    presentation: SingleAssignmentSubmitPresentation,
  ) => void;
  onSucceeded: (result: SingleAssignmentResult) => void;
  placement: "dialog" | "inline";
  progress: AssignmentProgressItem | null;
  student: AssignmentStudentItem;
  submitPlacement?: "footer" | "external";
  units: readonly AssignmentUnitItem[];
};
