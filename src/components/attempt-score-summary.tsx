import {
  buildAttemptScoreSlots,
  buildAttemptStatusPresentation,
  type AttemptScorePresentationInput,
} from "@/lib/ui/attempt-score-presentation";

export function AttemptScoreSummary({
  className = "",
  ...input
}: AttemptScorePresentationInput & { className?: string }) {
  const slots = buildAttemptScoreSlots(input);

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
    <span
      className={["attempt-status-label", presentation.className, className]
        .filter(Boolean)
        .join(" ")}
    >
      {presentation.label}
    </span>
  );
}
