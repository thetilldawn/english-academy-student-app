import type {
  AssignmentDatasetItem,
  AssignmentProgressItem,
  AssignmentStudentItem,
  AssignmentUnitItem,
} from "../catalog-types";
import type { AssignmentEditDraft } from "@/lib/admin/assignment-edit";
import type {
  SingleAssignmentResult,
  SingleAssignmentSubmitPresentation,
} from "../contracts/single-assignment-editor-contract";

export type {
  SingleAssignmentResult,
  SingleAssignmentSubmitPresentation,
} from "../contracts/single-assignment-editor-contract";

export type SingleAssignmentEditorProps = {
  datasets: readonly AssignmentDatasetItem[];
  editTarget: {
    assignmentId: string;
    purpose: "regular" | "mixed" | "review";
    studentId: string;
  } | null;
  formId?: string;
  initialDatasetId: string;
  initialEditDraft?: AssignmentEditDraft;
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
