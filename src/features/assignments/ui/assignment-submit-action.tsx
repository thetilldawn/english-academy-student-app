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
  size = "large",
}: {
  blockedReason: string | null;
  canSubmit: boolean;
  formId: string;
  label: string;
  size?: ButtonSize;
}) {
  return (
    <ActionWithReason reason={blockedReason}>
      <Button
        disabled={!canSubmit}
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
