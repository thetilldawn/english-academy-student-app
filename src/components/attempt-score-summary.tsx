import {
  buildAttemptScoreSlots,
  buildAttemptStatusPresentation,
  type AttemptScorePresentationInput,
} from "@/lib/ui/attempt-score-presentation";
import { StatusBadge } from "@/components/status-badge";

export function AttemptScoreSummary({
  className = "",
  compact = false,
  ...input
}: AttemptScorePresentationInput & {
  className?: string;
  compact?: boolean;
}) {
  const slots = buildAttemptScoreSlots(input, { compact });
  if (slots.every((slot) => slot === null)) return null;

  return (
    <span
      className={["attempt-score-summary", className]
        .filter(Boolean)
        .join(" ")}
    >
      {slots.map((slot, index) =>
        slot ? (
          <span
            className={`attempt-score-slot score-${slot.tone}`}
            key={`${slot.label}-${index}`}
          >
            <small>{slot.label}</small>
            <strong>{slot.value}</strong>
          </span>
        ) : (
          <span
            aria-hidden="true"
            className="attempt-score-slot attempt-score-slot-empty"
            key={`empty-${index}`}
          />
        ),
      )}
    </span>
  );
}

export function AttemptStatusLabel({
  className = "",
  ...input
}: AttemptScorePresentationInput & { className?: string }) {
  const presentation = buildAttemptStatusPresentation(input);
  return (
    <StatusBadge
      className={[
        "attempt-status-label",
        presentation.className,
        className,
      ]
        .filter(Boolean)
        .join(" ")}
      tone={presentation.tone}
    >
      {presentation.label}
    </StatusBadge>
  );
}
