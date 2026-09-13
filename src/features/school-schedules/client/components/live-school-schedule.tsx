"use client";
import { useEffect, useState, type ComponentProps } from "react";
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
  const today = useSchoolDisplayDate(props.overview.today);
  return <Timeline {...props} refreshNeeded={periodChanged(props.overview.today, today)} overview={{ ...props.overview, today, groups: props.overview.groups.map(group => ({ ...group, summary: { ...group.summary, today } })) }} />;
}
