import type { ReactNode } from "react";
import type { SchoolScheduleOverview } from "../contracts/school-schedule";
import { nearestSchoolExam, scheduleStatusText, scheduleWeek, shortSchoolDate } from "../domain/school-schedule";
import styles from "./school-schedule.module.css";

export function SchoolTimeline({ overview, retry, student = false, studentViewer = false, refreshNeeded = false }: { overview: SchoolScheduleOverview; retry?: ReactNode; student?: boolean; studentViewer?: boolean; refreshNeeded?: boolean }) {
  const entries = overview.groups.flatMap(group => group.summary.events.map(event => ({ group, event })));
  const dated = entries.filter(({ event }) => event.startDate && event.endDate && event.endDate >= overview.today && event.status !== "not-held")
    .sort((a, b) => a.event.startDate!.localeCompare(b.event.startDate!) || (a.group.summary.schoolName ?? "").localeCompare(b.group.summary.schoolName ?? ""));
  const weeks = [...new Set(dated.map(({ event }) => scheduleWeek(event.startDate!)))];
  const pending = entries.filter(({ event }) => !event.startDate);
  return <section className={styles.panel} aria-label={student ? "우리 학교 시험 일정" : "학교별 시험 일정"}>
    <div className={styles.panelHeading}><h2>{student ? "우리 학교 시험 일정" : "학교별 시험 일정"}</h2><span>기준 {overview.today}</span></div>
    {refreshNeeded || overview.status === "error" ? <div role="alert"><p>{refreshNeeded ? "새 학기 일정을 다시 확인해 주세요." : scheduleStatusText("error")}</p>{retry}</div> : <>
      {overview.groups.length === 0 ? <p className={styles.hint}>등록된 학생의 학교 일정이 없습니다.</p> : null}
      <div className={styles.schoolSummaries}>{overview.groups.map((group, index) => {
        const next = nearestSchoolExam(group.summary);
        return <div key={`${group.summary.schoolKey}-${group.summary.gradeLabel}-${index}`} className={styles.schoolSummary}>
          <strong>{group.summary.schoolName || "학교 미등록"} · {group.summary.gradeLabel || "학년 미등록"}</strong>
          {!student ? <span>{group.studentCount}명</span> : null}
          <span className={styles.summaryDate}>{next?.label ?? scheduleStatusText(group.summary.status, studentViewer)}</span>
        </div>;
      })}</div>
      <ol className={styles.timeline}>{weeks.map(week => <li key={week} className={styles.week}>
        <div className={styles.weekLabel}><span>{shortSchoolDate(week)}</span><small>시작 주</small></div>
        <div className={styles.weekEvents}>{dated.filter(({ event }) => scheduleWeek(event.startDate!) === week).map(({ group, event }) =>
          <article key={`${group.summary.schoolKey}-${event.id}`} className={styles.event}>
            <div className={styles.eventHeading}><strong>{group.summary.schoolName} · {event.grade}학년</strong><span className={styles.kind}>{event.kind === "written" ? "지필" : "수행"}</span></div>
            <p>{event.subject ? `${event.subject} · ` : ""}{event.title}</p>
            <div className={styles.eventMeta}><time dateTime={event.startDate!}>{shortSchoolDate(event.startDate!)}{event.endDate !== event.startDate ? `–${shortSchoolDate(event.endDate!)}` : ""}</time>
              {event.status === "planned" ? <span>예정</span> : null}
              {event.kind === "written" ? <span>학교 시험기간</span> : null}
              {event.applicability === "enrollment-unconfirmed" ? <span>수강 여부 확인 필요</span> : null}
              {event.sourceUrl ? <a href={event.sourceUrl} target="_blank" rel="noreferrer">{event.sourceLabel ?? "학교 공지"}</a> : <span>{event.sourceLabel}</span>}
            </div>
          </article>)}</div>
      </li>)}</ol>
      {pending.length ? <details className={styles.pending} open><summary>수행평가·미확정 일정 ({pending.length})</summary>
        <ul>{pending.map(({ group, event }) => <li key={`${group.summary.schoolKey}-${event.id}`}>
          <div><strong>{group.summary.schoolName} · {event.grade}학년{event.subject ? ` · ${event.subject}` : ""}</strong><p>{event.title}{event.maxPoints !== null ? ` (${event.maxPoints}점 만점)` : ""}</p>
            {event.applicability === "enrollment-unconfirmed" ? <small>수강 여부 확인 필요</small> : null}</div>
          <span>{event.status === "not-held" ? "미실시" : ["month", "week"].includes(event.precision) ? `${event.dateText} · 예정` : "날짜 확인 중"}</span>
          {event.sourceUrl ? <a href={event.sourceUrl} target="_blank" rel="noreferrer">{event.sourceLabel ?? "학교 공지"}</a> : <span>{event.sourceLabel}</span>}
        </li>)}</ul>
      </details> : null}
    </>}
  </section>;
}
