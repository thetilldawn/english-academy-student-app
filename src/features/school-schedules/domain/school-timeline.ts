import type { SchoolScheduleEvent, SchoolScheduleGroup, SchoolScheduleOverview } from "../contracts/school-schedule";
import { isUpcomingSchoolEvent, schoolEventDates } from "./school-schedule";

export const scheduleKindLabel = { performance: "수행", written: "지필", csat: "수능" } as const;
export type TimelineEntry = { group: SchoolScheduleGroup; event: SchoolScheduleEvent; groupKey: string };
export type DateCluster = { startDate: string; endDate: string; entries: TimelineEntry[] };
type ScheduleMonth = { month: string; clusters: DateCluster[]; pending: TimelineEntry[] };
const groupKey = (group: SchoolScheduleGroup) => JSON.stringify([group.summary.schoolKey, group.summary.schoolName, group.summary.gradeLabel]);

function knownMonth(event: SchoolScheduleEvent) {
  if (event.kind === "written" && event.startDate && event.endDate) {
    return event.startDate.slice(0, 7) === event.endDate.slice(0, 7) ? event.startDate.slice(0, 7) : null;
  }
  if (!["week", "month"].includes(event.precision)) return null;
  // A shared 월 suffix can describe several months (10~11월); do not narrow it to the last one.
  if (/\d\s*(?:[~∼～\-–—·,\/]|또는|및|와|과)\s*\d{1,2}\s*월/.test(event.dateText)) return null;
  const months = [...new Set([...event.dateText.matchAll(/(?<!\d)(1[0-2]|[1-9])\s*월/g)].map(match => Number(match[1])))];
  if (months.length !== 1) return null;
  const years = [...new Set([...event.dateText.matchAll(/(20\d{2})\s*년/g)].map(match => Number(match[1])))];
  if (years.length > 1) return null;
  const month = months[0];
  const year = years[0] ?? event.academicYear + (event.semester === 2 && month < 3 ? 1 : 0);
  return `${year}-${String(month).padStart(2, "0")}`;
}

function groupDates(entries: TimelineEntry[]) {
  const dated = entries.map(entry => ({ entry, dates: schoolEventDates(entry.event)! }))
    .sort((a, b) => a.dates.startDate.localeCompare(b.dates.startDate)
      || a.entry.event.kind.localeCompare(b.entry.event.kind) || a.entry.groupKey.localeCompare(b.entry.groupKey) || a.entry.event.id.localeCompare(b.entry.event.id));
  const clusters: DateCluster[] = [];
  for (const { entry, dates } of dated) {
    const last = clusters.at(-1);
    if (last && dates.startDate <= last.endDate) {
      last.entries.push(entry);
      if (dates.endDate > last.endDate) last.endDate = dates.endDate;
    } else clusters.push({ ...dates, entries: [entry] });
  }
  return clusters;
}

export function schoolTimeline(overview: SchoolScheduleOverview) {
  const currentMonth = overview.today.slice(0, 7);
  const entries = overview.groups.flatMap(group => group.summary.events.map(event => ({ group, event, groupKey: groupKey(group) })));
  const active = entries.filter(({ event }) => isUpcomingSchoolEvent(event, overview.today));
  const national = new Map<string, TimelineEntry>();
  for (const entry of active.filter(entry => entry.event.kind === "csat")) {
    const prior = national.get(entry.event.id);
    if (prior) prior.group.studentCount += entry.group.studentCount;
    else national.set(entry.event.id, { ...entry, groupKey: entry.event.id, group: { ...entry.group, studentCount: entry.group.studentCount } });
  }
  const months = new Map<string, { dated: TimelineEntry[]; pending: TimelineEntry[] }>();
  const pending: TimelineEntry[] = [];
  if (overview.groups.length) months.set(currentMonth, { dated: [], pending: [] });
  for (const entry of [...active.filter(entry => entry.event.kind !== "csat"), ...national.values()]) {
    const dates = schoolEventDates(entry.event);
    const month = dates ? (dates.startDate < overview.today ? currentMonth : dates.startDate.slice(0, 7)) : knownMonth(entry.event);
    if (!month) { pending.push(entry); continue; }
    if (month < currentMonth) continue;
    const bucket = months.get(month) ?? { dated: [], pending: [] };
    (dates ? bucket.dated : bucket.pending).push(entry);
    months.set(month, bucket);
  }
  // Assign months before clustering so a range cannot pull the next month's rows into its month.
  const grouped: ScheduleMonth[] = [...months.entries()].sort(([a], [b]) => a.localeCompare(b))
    .map(([month, value]) => ({ month, clusters: groupDates(value.dated), pending: value.pending }));
  const visible = [...grouped.flatMap(month => [...month.clusters.flatMap(cluster => cluster.entries), ...month.pending]), ...pending];
  // A school/grade group represents disjoint students; repeated tasks never multiply its count.
  const counts = Object.fromEntries(Object.keys(scheduleKindLabel).map(kind => {
    const groups = new Map(visible.filter(entry => entry.event.kind === kind && entry.event.applicability === "grade").map(entry => [entry.groupKey, entry.group.studentCount]));
    return [kind, [...groups.values()].reduce((sum, count) => sum + count, 0)];
  })) as Record<SchoolScheduleEvent["kind"], number>;
  return { months: grouped, clusters: grouped.flatMap(month => month.clusters), pending, counts };
}
export function schoolScheduleEditHref(entry?: TimelineEntry) {
  const query = new URLSearchParams();
  if (entry?.group.summary.schoolKey) {
    query.set("school", entry.group.summary.schoolKey);
    query.set("grade", String(entry.event.grade)); query.set("semester", String(entry.event.semester)); query.set("event", entry.event.id);
  }
  return `/admin/school-schedules/edit${query.size ? `?${query}` : ""}`;
}
