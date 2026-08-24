"use client";

import { useRef, useState } from "react";

import { prefersReducedMotion } from "@/lib/ui/motion";

import type { SingleAssignmentController } from "../controller/use-assignment-controller";
import {
  assignmentEditFieldErrors,
  assignmentEditFieldKeyForPath,
} from "../presentation/assignment-edit-field-errors";
import { assignmentEditSubmitPresentation } from "../presentation/assignment-edit-submit-presentation";
import { resolveInvalidAssignmentFieldFocusTarget } from "./focus-invalid-assignment-field";

export function useEditAssignmentValidation({
  blockedReason,
  controller,
}: {
  blockedReason: string | null;
  controller: SingleAssignmentController;
}) {
  const formRef = useRef<HTMLFormElement>(null);
  const [submitAttempted, setSubmitAttempted] = useState(false);
  const submitPresentation = assignmentEditSubmitPresentation({
    blocker: controller.submitBlocker,
    canSubmit: controller.canSubmit,
    submitAttempted,
  });
  const issueFieldErrors = assignmentEditFieldErrors(controller.issues);
  const fieldErrors = submitAttempted
    ? {
        ...issueFieldErrors,
        ...(controller.submitBlocker?.code === "range_unavailable" ||
        controller.submitBlocker?.code === "no_review_words"
          ? { range: issueFieldErrors.range || blockedReason || "범위 확인" }
          : {}),
        ...(controller.submitBlocker?.code === "question_count_too_low" ||
        controller.submitBlocker?.code === "question_count_too_high"
          ? {
              questionCount:
                issueFieldErrors.questionCount || blockedReason || "단어 수 확인",
            }
          : {}),
      }
    : {};

  function focusFirstInvalidField() {
    const blocker = controller.submitBlocker;
    const fieldKey = blocker?.code === "invalid"
      ? assignmentEditFieldKeyForPath(blocker.path)
      : blocker?.code === "range_unavailable" ||
          blocker?.code === "no_review_words"
        ? "range"
        : blocker?.code === "question_count_too_low" ||
            blocker?.code === "question_count_too_high"
          ? "questionCount"
          : null;
    if (!fieldKey) return;
    window.requestAnimationFrame(() => {
      const target = formRef.current?.querySelector<HTMLElement>(
        `[data-field-key="${fieldKey}"]`,
      );
      if (!target) return;
      target.scrollIntoView({
        behavior: prefersReducedMotion() ? "auto" : "smooth",
        block: "center",
      });
      resolveInvalidAssignmentFieldFocusTarget(target)?.focus({
        preventScroll: true,
      });
    });
  }

  function prepareSubmit() {
    setSubmitAttempted(true);
    if (controller.canSubmit) return true;
    focusFirstInvalidField();
    return false;
  }

  return {
    canSubmit: submitPresentation.canSubmit,
    fieldErrors,
    focusFirstInvalidField,
    formRef,
    showBlockedReason: submitPresentation.showBlockedReason,
    prepareSubmit,
  };
}
