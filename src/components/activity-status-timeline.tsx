import { StatusBadge } from "@/design-system/primitives/badge/badge";
import { formatKoreanActivityDateTime } from "@/lib/format";
import {
  buildActivityStatusTimeline,
  type ActivityTimelineInput,
  type ActivityTimelineRow,
} from "@/lib/ui/learning-activity-presentation";

function TimelineRow({ row }: { row: ActivityTimelineRow }) {
  return (
    <span className="activity-status-timeline-row" data-kind={row.kind}>
      <StatusBadge tone={row.tone}>{row.label}</StatusBadge>
      {row.timestamp ? (
        <time dateTime={row.timestamp}>
          {formatKoreanActivityDateTime(row.timestamp)}
        </time>
      ) : null}
    </span>
  );
}

export function ActivityStatusTimeline({
  className = "",
  item,
  showDeadline = true,
}: {
  className?: string;
  item: ActivityTimelineInput;
  showDeadline?: boolean;
}) {
  const presentation = buildActivityStatusTimeline(item);

  return (
    <span
      className={["activity-status-timeline", className]
        .filter(Boolean)
        .join(" ")}
    >
      {showDeadline && presentation.deadline ? (
        <TimelineRow row={presentation.deadline} />
      ) : null}
      <TimelineRow row={presentation.status} />
    </span>
  );
}
