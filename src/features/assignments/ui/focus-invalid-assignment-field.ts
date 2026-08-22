const interactiveSelector =
  "button, input, select, textarea, [tabindex]:not([tabindex='-1'])";

export function resolveInvalidAssignmentFieldFocusTarget(
  target: HTMLElement,
): HTMLElement | null {
  if (
    target.matches("button, input, select, textarea") ||
    target.hasAttribute("tabindex")
  ) {
    return target;
  }
  return target.querySelector<HTMLElement>(interactiveSelector);
}
