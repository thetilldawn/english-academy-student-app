import type { SchoolScheduleEvent, SchoolScheduleGroup, SchoolScheduleOverview } from "../contracts/school-schedule";
export const scheduleKindLabel = { performance: "수행", written: "지필", csat: "수능" } as const;
export type TimelineEntry = { group: SchoolScheduleGroup; event: SchoolScheduleEvent; groupKey: string };
export type DateCluster = { startDate: string; endDate: string; entries: TimelineEntry[] };
const groupKey = (group: SchoolScheduleGroup) => JSON.stringify([group.summary.schoolKey, group.summary.schoolName, group.summary.gradeLabel]);
export function schoolTimeline(overview: SchoolScheduleOverview) {
  const entries = overview.groups.flatMap(group => group.summary.events.map(event => ({ group, event, groupKey: groupKey(group) })));
  const active = entries.filter(({ event }) => event.status !== "not-held" && (!event.endDate || event.endDate >= overview.today));
  const national = new Map<string, TimelineEntry>();
  for (const entry of active.filter(entry => entry.event.kind === "csat")) {
    const prior = national.get(entry.event.id);
    if (prior) prior.group.studentCount += entry.group.studentCount;
    else national.set(entry.event.id, { ...entry, groupKey: entry.event.id, group: { ...entry.group, studentCount: entry.group.studentCount } });
  }
  const dated = [...active.filter(entry => entry.event.kind !== "csat"), ...national.values()].filter(({ event }) => event.startDate && event.endDate).sort((a,b) => a.event.startDate!.localeCompare(b.event.startDate!)
    || a.event.kind.localeCompare(b.event.kind) || a.groupKey.localeCompare(b.groupKey) || a.event.id.localeCompare(b.event.id));
  const clusters: DateCluster[] = [];
  for (const entry of dated) {
    const last = clusters.at(-1);
    if (last && entry.event.startDate! <= last.endDate) {
      last.entries.push(entry);
      if (entry.event.endDate! > last.endDate) last.endDate = entry.event.endDate!;
    } else clusters.push({ startDate: entry.event.startDate!, endDate: entry.event.endDate!, entries: [entry] });
  }
  // Each group is a disjoint set of active students; repeated tasks never multiply its count.
  const counts = Object.fromEntries(Object.keys(scheduleKindLabel).map(kind => {
    const groups = new Map(active.filter(entry => entry.event.kind === kind && entry.event.applicability === "grade").map(entry => [entry.groupKey, entry.group.studentCount]));
    return [kind, [...groups.values()].reduce((sum, count) => sum + count, 0)];
  })) as Record<SchoolScheduleEvent["kind"], number>;
  return { clusters, pending: active.filter(entry => !entry.event.startDate), counts };
}
export function schoolScheduleEditHref(entry?: TimelineEntry) {
  const query = new URLSearchParams();
  if (entry?.group.summary.schoolKey) {
    query.set("school", entry.group.summary.schoolKey);
    query.set("grade", String(entry.event.grade)); query.set("semester", String(entry.event.semester)); query.set("event", entry.event.id);
  }
  return `/admin/school-schedules/edit${query.size ? `?${query}` : ""}`;
}
