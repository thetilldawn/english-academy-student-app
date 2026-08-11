import { ActivityTimeline } from "@/design-system/patterns/activity-timeline/activity-timeline";
import { formatKoreanActivityDateTime } from "@/lib/format";

import {
  buildActivityStatusTimeline,
  type ActivityTimelineInput,
} from "../presentation/activity-presentation";

export function ActivityStatusTimeline({
  align = "start",
  item,
  showDeadline = true,
}: {
  align?: "end" | "start";
  item: ActivityTimelineInput;
  showDeadline?: boolean;
}) {
  const presentation = buildActivityStatusTimeline(item);
  const rows = [
    ...(showDeadline && presentation.deadline
      ? [presentation.deadline]
      : []),
    presentation.status,
  ].map((row) => ({
    dateTime: row.timestamp,
    kind: row.kind,
    label: row.label,
    timestamp: row.timestamp
      ? formatKoreanActivityDateTime(row.timestamp)
      : null,
    tone: row.tone,
  }));

  return <ActivityTimeline align={align} rows={rows} />;
}
