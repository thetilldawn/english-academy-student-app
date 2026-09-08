import { MetaTag } from "@/design-system/primitives/badge/badge";
import { ActivityTimeline } from "@/design-system/patterns/activity-timeline/activity-timeline";
import { formatKoreanDateTime } from "@/lib/format";
import { followUpReleaseLabel, plannedSessionOpeningLabel } from "../presentation/assignment-release-view";

export function AssignmentSessionReleaseTags({ sessionNumber, availableFrom, availableUntil }: {
  sessionNumber: number;
  availableFrom: string | null;
  availableUntil: string | null;
}) {
  const followUp = followUpReleaseLabel(sessionNumber);
  return <>
    <ActivityTimeline rows={[
      { kind: "assigned", label: availableFrom ? (sessionNumber > 1 ? "예약 공개" : "공개") : "공개", tone: "neutral", dateTime: availableFrom, timestamp: availableFrom ? formatKoreanDateTime(availableFrom) : null },
      ...(availableUntil ? [{ kind: "deadline" as const, label: "마감", tone: "neutral" as const, dateTime: availableUntil, timestamp: formatKoreanDateTime(availableUntil) }] : []),
    ]} />
    {!availableFrom ? <MetaTag>{plannedSessionOpeningLabel(sessionNumber, availableFrom)}</MetaTag> : null}
    {followUp && availableFrom ? <MetaTag>{followUp}</MetaTag> : null}
  </>;
}
