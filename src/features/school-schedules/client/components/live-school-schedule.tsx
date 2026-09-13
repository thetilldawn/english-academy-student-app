"use client";
import { useEffect, useState, type ComponentProps } from "react";
import { subscribeAdminPrivateCacheChanges } from "@/features/session/public-client";
import { refreshSchoolScheduleOverviewAction } from "../../actions/edit-school-schedule";
import type { SchoolScheduleOverview } from "../../contracts/school-schedule";
import { schoolToday, schoolDisplayPeriod } from "../../domain/school-schedule";
import { SchoolExamIdentity as Identity } from "../../ui/school-exam-identity";
import { SchoolTimeline as Timeline } from "../../ui/school-timeline";

export function useSchoolDisplayDate(initial: string) {
  const [date, setDate] = useState(initial);
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout>;
    const update = () => {
      clearTimeout(timer);
      const today = schoolToday();
      setDate(today);
      const next = Date.parse(`${today}T00:00:00+09:00`) + 86400000;
      timer = setTimeout(update, Math.max(1000, next - Date.now() + 100));
    };
    const visible = () => { if (document.visibilityState === "visible") update(); };
    timer = setTimeout(update, 0);
    document.addEventListener("visibilitychange", visible);
    return () => { clearTimeout(timer); document.removeEventListener("visibilitychange", visible); };
  }, [initial]);
  return date;
}
function periodChanged(before: string, today: string) {
  return !!before && JSON.stringify(schoolDisplayPeriod(before)) !== JSON.stringify(schoolDisplayPeriod(today));
}
export function LiveSchoolExamIdentity(props: ComponentProps<typeof Identity>) {
  const today = useSchoolDisplayDate(props.summary?.today ?? "");
  return <Identity {...props} refreshNeeded={periodChanged(props.summary?.today ?? "", today)} summary={props.summary ? { ...props.summary, today } : undefined} />;
}
export function LiveSchoolTimeline(props: ComponentProps<typeof Timeline>) {
  const [fresh, setFresh] = useState<{ base: SchoolScheduleOverview; value: SchoolScheduleOverview } | null>(null);
  const overview = fresh?.base === props.overview ? fresh.value : props.overview;
  const today = useSchoolDisplayDate(overview.today);
  useEffect(() => {
    if (props.studentViewer) return;
    let live = true; let request = 0; let locked = false;
    const refresh = async () => {
      const current = ++request;
      try {
        const result = await refreshSchoolScheduleOverviewAction();
        if (!live || locked || current !== request) return;
        if (!result.ok || result.overview.status === "error") {
          if (!result.ok && result.status === 401) locked = true;
          setFresh({ base: props.overview, value: { status: "error", today: props.overview.today, groups: [] } }); return;
        }
        const value = props.student ? { ...result.overview, groups: result.overview.groups.filter(group => props.overview.groups.some(previous =>
          previous.summary.schoolKey === group.summary.schoolKey && previous.summary.gradeLabel === group.summary.gradeLabel)) } : result.overview;
        setFresh({ base: props.overview, value });
      } catch { if (live && current === request) setFresh({ base: props.overview, value: { status: "error", today: props.overview.today, groups: [] } }); }
    };
    const unsubscribe = subscribeAdminPrivateCacheChanges(kind => {
      if (kind === "identity") { locked = true; request++; setFresh({ base: props.overview, value: { status: "error", today: props.overview.today, groups: [] } }); }
      else void refresh();
    });
    return () => { live = false; request++; unsubscribe(); };
  }, [props.overview, props.student, props.studentViewer]);
  return <Timeline {...props} refreshNeeded={periodChanged(overview.today, today)} overview={{ ...overview, today, groups: overview.groups.map(group => ({ ...group, summary: { ...group.summary, today } })) }} />;
}
