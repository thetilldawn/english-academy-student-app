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
  size = "large",
}: {
  blockedReason: string | null;
  canSubmit: boolean;
  formId: string;
  label: string;
  reasonLayout?: "inline" | "remaining-center";
  size?: ButtonSize;
}) {
  return (
    <ActionWithReason layout={reasonLayout} reason={blockedReason}>
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
