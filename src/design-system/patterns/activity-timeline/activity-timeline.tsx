import type { StatusTone } from "../../primitives/badge/tone";
import { StatusBadge } from "../../primitives/badge/badge";

import styles from "./activity-timeline.module.css";

export type ActivityTimelineRow = {
  dateTime: string | null;
  kind: "assigned" | "deadline" | "status";
  label: string;
  timestamp: string | null;
  tone: StatusTone;
};

export function ActivityTimeline({
  align = "start",
  rows,
}: {
  align?: "end" | "start";
  rows: readonly ActivityTimelineRow[];
}) {
  return (
    <span className={styles.timeline} data-align={align}>
      {rows.map((row) => (
        <span className={styles.row} data-kind={row.kind} key={row.kind}>
          <StatusBadge tone={row.tone}>{row.label}</StatusBadge>
          {row.dateTime && row.timestamp ? (
            <time dateTime={row.dateTime}>{row.timestamp}</time>
          ) : null}
        </span>
      ))}
    </span>
  );
}
