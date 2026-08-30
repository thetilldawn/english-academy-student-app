import type { AdminHistoryMutationNotice } from "../contracts/admin-history-mutation";
import { adminHistorySectionKeys } from "../contracts/admin-history-read-model";
import type { AdminHistoryStatusFilter } from "./learning-activity";
import {
  adminHistoryFilterBucket,
  learningActivitySection,
} from "./learning-activity";

export type AdminHistoryMutationImpact = {
  delta: number;
  groupKey: string;
};

export function adminHistoryMutationImpact(
  notice: AdminHistoryMutationNotice,
  input: {
    currentOnly: boolean;
    statusFilter: AdminHistoryStatusFilter;
  },
): AdminHistoryMutationImpact[] {
  if (input.currentOnly && notice.receipt.kind === "hidden") {
    if (input.statusFilter !== "all") {
      return [{ delta: 0, groupKey: `filter-${input.statusFilter}` }];
    }
    return adminHistorySectionKeys
      .filter((groupKey) => groupKey !== "archived")
      .map((groupKey) => ({ delta: 0, groupKey }));
  }
  if (input.statusFilter !== "all") {
    const beforeMatches =
      adminHistoryFilterBucket(notice.before) === input.statusFilter;
    const afterMatches = notice.after
      ? adminHistoryFilterBucket(notice.after) === input.statusFilter
      : false;
    const delta = Number(afterMatches) - Number(beforeMatches);
    return beforeMatches || afterMatches
      ? [{ delta, groupKey: `filter-${input.statusFilter}` }]
      : [];
  }

  const deltas = new Map<string, number>();
  const beforeGroup = learningActivitySection(notice.before);
  deltas.set(beforeGroup, (deltas.get(beforeGroup) ?? 0) - 1);
  if (notice.after) {
    const afterGroup = learningActivitySection(notice.after);
    deltas.set(afterGroup, (deltas.get(afterGroup) ?? 0) + 1);
  }
  if (input.currentOnly) deltas.delete("archived");
  return [...deltas.entries()]
    .filter(([, delta]) => delta !== 0)
    .map(([groupKey, delta]) => ({ delta, groupKey }));
}
