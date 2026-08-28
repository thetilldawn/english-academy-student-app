import {
  assignmentEditFieldKeys,
  assignmentEditFieldPolicy,
  type AssignmentEditFieldKey,
  type AssignmentEditFieldPolicy,
} from "@/lib/admin/assignment-edit-policy";

import type { SingleAssignmentDraft } from "./model";

const createPolicy = Object.fromEntries(
  assignmentEditFieldKeys.map((field) => [field, "editable"]),
) as AssignmentEditFieldPolicy;

export function singleAssignmentFieldPolicy(
  draft: SingleAssignmentDraft,
): AssignmentEditFieldPolicy {
  if (draft.operation.mode === "create") return createPolicy;
  return assignmentEditFieldPolicy(draft.operation.sourcePurpose, {
    seriesItem: draft.operation.seriesItem,
  });
}

export function canEditSingleAssignmentField(
  draft: SingleAssignmentDraft,
  field: AssignmentEditFieldKey,
) {
  return singleAssignmentFieldPolicy(draft)[field] === "editable";
}
