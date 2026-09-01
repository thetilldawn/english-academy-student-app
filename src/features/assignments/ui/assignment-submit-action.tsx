import { useId } from "react";

import {
  Button,
  ButtonSpinner,
  type ButtonSize,
} from "@/design-system/primitives/button/button";
import { ActionWithReason } from "@/design-system/patterns/action-reason/action-reason";

export function AssignmentSubmitAction({
  blockedReason,
  canSubmit,
  formId,
  label,
  pending = false,
  reasonLayout = "inline",
  reasonPosition = "after",
  size = "large",
  focusableWhenBlocked = false,
}: {
  blockedReason: string | null;
  canSubmit: boolean;
  formId: string;
  label: string;
  pending?: boolean;
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
        aria-busy={pending || undefined}
        aria-describedby={blockedReason ? reasonId : undefined}
        aria-disabled={!canSubmit || pending}
        disabled={pending || (!canSubmit && !focusableWhenBlocked)}
        form={formId}
        size={size}
        type="submit"
        variant="primary"
      >
        {pending ? <ButtonSpinner /> : null}
        {label}
      </Button>
    </ActionWithReason>
  );
}
