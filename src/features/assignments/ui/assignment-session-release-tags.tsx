import { MetaTag } from "@/design-system/primitives/badge/badge";
import { formatKoreanDateTime } from "@/lib/format";
import { followUpReleaseLabel, plannedSessionOpeningLabel } from "../presentation/assignment-release-view";

export function AssignmentSessionReleaseTags({ sessionNumber, availableFrom, availableUntil, previousAvailableUntil }: {
  sessionNumber: number;
  availableFrom: string | null;
  availableUntil: string | null;
  previousAvailableUntil: string | null;
}) {
  const followUp = followUpReleaseLabel(sessionNumber, previousAvailableUntil !== null);
  return <>
    <MetaTag size="large">{plannedSessionOpeningLabel(sessionNumber, availableFrom)}</MetaTag>
    {availableUntil ? <MetaTag size="large">{formatKoreanDateTime(availableUntil)} 마감</MetaTag> : null}
    {followUp && availableFrom ? <MetaTag size="large">{followUp}</MetaTag> : null}
  </>;
}
