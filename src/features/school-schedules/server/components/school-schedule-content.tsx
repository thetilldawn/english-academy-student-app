import { getAdminSchoolScheduleOverview, getCurrentStudentSchoolSchedule } from "../queries/school-schedule-query";
import { LiveSchoolTimeline as SchoolTimeline, LiveSchoolExamIdentity as SchoolExamIdentity } from "../../client/components/live-school-schedule";
import { ScheduleRetry } from "../../client/components/schedule-retry";
import type { ReactNode } from "react";
export async function AdminSchoolScheduleContent() {
  return <SchoolTimeline overview={await getAdminSchoolScheduleOverview()} retry={<ScheduleRetry />} />;
}
export async function StudentSchoolScheduleContent() {
  const summary = await getCurrentStudentSchoolSchedule();
  return <SchoolTimeline overview={{ status: summary.status === "error" ? "error" : "ready", today: summary.today, groups: [{ summary, studentCount: 1 }] }} student studentViewer retry={<ScheduleRetry />} />;
}
export async function StudentSchoolIdentity({ children }: { children: ReactNode }) {
  return <SchoolExamIdentity summary={await getCurrentStudentSchoolSchedule()} as="span">{children}</SchoolExamIdentity>;
}
