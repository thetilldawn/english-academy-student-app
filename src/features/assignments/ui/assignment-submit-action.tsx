import { useId } from "react";

import {
  Button,
  type ButtonSize,
} from "@/design-system/primitives/button/button";
import { ActionWithReason } from "@/design-system/patterns/action-reason/action-reason";

export function AssignmentSubmitAction({
  blockedReason,
  canSubmit,
  formId,
  label,
  reasonLayout = "inline",
  reasonPosition = "after",
  size = "large",
  focusableWhenBlocked = false,
}: {
  blockedReason: string | null;
  canSubmit: boolean;
  formId: string;
  label: string;
  reasonLayout?: "inline" | "remaining-center";
  reasonPosition?: "before" | "after";
  size?: ButtonSize;
  focusableWhenBlocked?: boolean;
}) {
  const reasonId = useId();
  return (
    <ActionWithReason
      layout={reasonLayout}
      reason={blockedReason}
      reasonId={blockedReason ? reasonId : undefined}
      reasonPosition={reasonPosition}
    >
      <Button
        aria-describedby={blockedReason ? reasonId : undefined}
        aria-disabled={!canSubmit}
        disabled={!canSubmit && !focusableWhenBlocked}
        form={formId}
        size={size}
        type="submit"
        variant="primary"
      >
        {label}
      </Button>
    </ActionWithReason>
  );
}
