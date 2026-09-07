import { adminLearningText } from "@/content/ko/admin-learning";
import { assignmentQuestionModeAvailability, assignmentQuestionModePolicy } from "../domain/assignment-question-mode-policy";
import type { AssignmentQuestionMode } from "../domain/model";

export type AssignmentQuestionModeView = {
  value: AssignmentQuestionMode;
  tabs: { value: AssignmentQuestionMode; label: string; disabled?: boolean; describedBy?: string }[];
  notices: { id?: string; role?: "alert" | "status"; message: string }[];
};

export function assignmentQuestionModeView(input: {
  questionMode: AssignmentQuestionMode;
  datasetSelected: boolean;
  availableModes?: readonly AssignmentQuestionMode[];
}): AssignmentQuestionModeView {
  const text = adminLearningText.questionMode;
  const availability = assignmentQuestionModeAvailability(input);
  const sharedId = availability.status === "unselected" ? "question-mode-dataset-required"
    : availability.status === "unavailable" ? "question-mode-status-unavailable" : undefined;
  const notices: AssignmentQuestionModeView["notices"] = [];
  if (availability.status === "unselected") notices.push({ id: sharedId, message: text.datasetRequired });
  if (availability.status === "unavailable") notices.push({ id: sharedId, role: "alert", message: text.statusUnavailable });
  if (availability.availableModes.includes(input.questionMode) &&
      assignmentQuestionModePolicy(input.questionMode).schedule === "single-immediate") {
    notices.push({ role: "status", message: text.prepared });
  }
  const canonicalTabs = ([
    ["canonical_definition_to_headword", text.definition, "definition-mode-unavailable", text.definitionUnavailable],
    ["canonical_headword_to_definition", text.reverseDefinition, "reverse-definition-mode-unavailable", text.reverseDefinitionUnavailable],
    ["canonical_example_to_headword", text.example, "example-mode-unavailable", text.exampleUnavailable],
  ] as const).map(([value, label, id, unavailableMessage]) => {
    const disabled = !availability.availableModes.includes(value);
    if (!sharedId && disabled) notices.push({ id, message: unavailableMessage });
    return { value, label, disabled, describedBy: disabled ? sharedId ?? id : undefined };
  });
  return { value: input.questionMode, tabs: [{ value: "book_meaning_choice", label: text.book }, ...canonicalTabs], notices };
}

export function assignmentQuestionModeScheduleMessage(mode: AssignmentQuestionMode) {
  return assignmentQuestionModePolicy(mode).schedule === "single-immediate"
    ? adminLearningText.questionMode.scheduleRestriction : null;
}
