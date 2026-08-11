import { ScoreSummary } from "@/design-system/patterns/score-summary/score-summary";
import { StatusBadge } from "@/design-system/primitives/badge/badge";

import {
  buildAttemptScoreSlots,
  buildAttemptStatusPresentation,
  type AttemptScorePresentationInput,
} from "../presentation/attempt-presentation";

export function AttemptScoreSummary({
  compact = false,
  ...input
}: AttemptScorePresentationInput & { compact?: boolean }) {
  const slots = buildAttemptScoreSlots(input, { compact }).map(
    (slot, index) =>
      slot
        ? {
            ...slot,
            key: `${slot.label}-${index}`,
          }
        : null,
  );
  return <ScoreSummary slots={slots} />;
}

export function AttemptStatusLabel(
  input: AttemptScorePresentationInput,
) {
  const presentation = buildAttemptStatusPresentation(input);
  return (
    <StatusBadge
      data-outcome={presentation.outcome}
      size="small"
      tone={presentation.tone}
    >
      {presentation.label}
    </StatusBadge>
  );
}
