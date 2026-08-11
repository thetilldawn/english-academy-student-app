import styles from "./score-summary.module.css";

export type ScoreTone = "neutral" | "pass" | "fail";

export type ScoreSlot = {
  key: string;
  label: string;
  tone: ScoreTone;
  value: string;
} | null;

export function ScoreSummary({ slots }: { slots: readonly ScoreSlot[] }) {
  if (slots.every((slot) => slot === null)) return null;

  return (
    <span className={styles.summary}>
      {slots.map((slot, index) =>
        slot ? (
          <span className={styles.slot} data-tone={slot.tone} key={slot.key}>
            <small>{slot.label}</small>
            <strong>{slot.value}</strong>
          </span>
        ) : (
          <span
            aria-hidden="true"
            className={styles.empty}
            key={`empty-${index}`}
          />
        ),
      )}
    </span>
  );
}
