import type { AssignmentReplacementResult } from "@/lib/admin/assignment-edit";

export type SingleAssignmentResult =
  | { assignmentId: string }
  | AssignmentReplacementResult;

export type SingleAssignmentSubmitPresentation = {
  blockedReason: string | null;
  canSubmit: boolean;
  dirty: boolean;
  formId: string;
  label: string;
};
