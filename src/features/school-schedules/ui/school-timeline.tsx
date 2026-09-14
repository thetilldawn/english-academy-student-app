import Link from "next/link";
import type { ReactNode } from "react";
import { CollapsibleStatusSection } from "@/design-system/patterns/collapsible-status-section/collapsible-status-section";
import type { SchoolScheduleOverview } from "../contracts/school-schedule";
import { schoolEventDates, scheduleStatusText, shortSchoolDate } from "../domain/school-schedule";
import { schoolTimeline, scheduleKindLabel, schoolScheduleEditHref, type DateCluster, type TimelineEntry } from "../domain/school-timeline";
import styles from "./school-schedule.module.css";

function Source({ entry }: { entry: TimelineEntry }) {
  const { event } = entry;
  return event.sourceUrl ? <a href={event.sourceUrl} target="_blank" rel="noreferrer">{event.sourceLabel ?? "학교 공지"}</a> : <span>{event.sourceLabel}</span>;
}
function EventInfo({ entry, highlighted, student, canEdit }: { entry: TimelineEntry; highlighted: boolean; student: boolean; canEdit: boolean }) {
  const { event, group } = entry;
  const uncertain = event.applicability === "enrollment-unconfirmed";
  const dates = schoolEventDates(event);
  const missingDate = event.kind === "written" ? "영어 시험일 확인 필요" : ["week", "month"].includes(event.precision) ? event.dateText : "날짜 확인 필요";
  return <div className={styles.eventRow} data-kind={event.kind} data-highlighted={highlighted}>
    <span className={styles.kind} data-kind={event.kind}>{scheduleKindLabel[event.kind]}</span>
    <div className={styles.eventInfo}>
      <div className={styles.tags}>
        <span>{event.kind === "csat" ? "전국" : group.summary.schoolName}</span><span>{event.grade}학년</span>
        {event.subject ? <span>{event.subject}</span> : null}
        {!student && !uncertain ? <span>{group.studentCount}명</span> : null}
        {uncertain ? <span className={styles.elective}>선택 과목</span> : null}
      </div>
      <strong className={styles.eventTitle}>{event.title}{event.maxPoints !== null ? " (" + event.maxPoints + "점 만점)" : ""}</strong>
      <div className={styles.eventMeta}>
        {dates ? <time dateTime={dates.startDate}>{event.kind === "written" ? "영어 " : ""}{shortSchoolDate(dates.startDate)}{dates.endDate !== dates.startDate ? "–" + shortSchoolDate(dates.endDate) : ""}</time> :
          canEdit && group.summary.schoolKey ? <Link className={styles.dateButton} href={schoolScheduleEditHref(entry)} scroll={false}>{missingDate}</Link> : <span>{missingDate}</span>}
        {event.status === "planned" && event.kind !== "written" ? <span className={styles.metaTag}>예정</span> : null}
        <Source entry={entry} />
        {canEdit && dates && event.kind !== "csat" && group.summary.schoolKey ? <Link href={schoolScheduleEditHref(entry)} scroll={false}>수정</Link> : null}
      </div>
      {event.kind === "written" && (event.startDate || event.dateText) ? <div className={styles.schoolPeriod}><span className={styles.metaTag}>학교 시험기간</span><span>{event.startDate ? shortSchoolDate(event.startDate) + (event.endDate !== event.startDate ? "–" + shortSchoolDate(event.endDate!) : "") : event.dateText}{event.status === "planned" ? " (예정)" : ""}</span></div> : null}
    </div>
  </div>;
}
function DateGroup({ cluster, highlighted, student, canEdit }: { cluster: DateCluster; highlighted: boolean; student: boolean; canEdit: boolean }) {
  return <li className={styles.dateGroup}>
    <div className={styles.dateLabel}><time dateTime={cluster.startDate}>{shortSchoolDate(cluster.startDate)}</time>{cluster.endDate !== cluster.startDate ? <small>~ {shortSchoolDate(cluster.endDate)}</small> : null}</div>
    <article className={styles.event} aria-label={shortSchoolDate(cluster.startDate) + " 일정"}>
      {highlighted ? <div className={styles.nearestLabel}>가장 가까운 일정</div> : null}
      {cluster.entries.map(entry => <EventInfo key={entry.groupKey + "-" + entry.event.id} entry={entry} highlighted={highlighted} student={student} canEdit={canEdit} />)}
    </article>
  </li>;
}
export function SchoolTimeline({ overview, retry, student = false, studentViewer = false, refreshNeeded = false }: { overview: SchoolScheduleOverview; retry?: ReactNode; student?: boolean; studentViewer?: boolean; refreshNeeded?: boolean }) {
  const { months, clusters, pending, counts } = schoolTimeline(overview);
  const currentMonth = overview.today.slice(0, 7);
  const hasEvents = clusters.length || pending.length || months.some(month => month.pending.length);
  const canEdit = !studentViewer;
  const failed = refreshNeeded || overview.status === "error";
  return <section className={styles.panel} aria-label={student ? "우리 학교 시험 일정" : "학교별 시험 일정"}>
    <div className={styles.panelHeading}><h2>{student ? "우리 학교 시험 일정" : "학교별 시험 일정"}</h2>
      <div className={styles.panelActions}><span>기준 {overview.today}</span>{canEdit ? <Link className={styles.manualButton} href={schoolScheduleEditHref()} scroll={false}>수동입력</Link> : null}</div></div>
    {failed ? <div role="alert"><p>{refreshNeeded ? "새 학기 일정을 다시 확인해 주세요." : scheduleStatusText("error")}</p>{retry}</div> : <>
      {!student && overview.groups.length ? <div className={styles.typeCounts} aria-label="평가 유형별 학생 수">{Object.entries(scheduleKindLabel).map(([kind,label]) => <span key={kind} className={styles.countTag} data-kind={kind}>{label} <strong>{counts[kind as keyof typeof counts]}명</strong></span>)}</div> : null}
      {overview.groups.length === 0 ? <p className={styles.hint}>등록된 학생의 학교 일정이 없습니다.</p> : null}
      {!hasEvents && overview.groups.length ? <p className={styles.hint}>{student ? scheduleStatusText(overview.groups[0].summary.status, studentViewer) : "확인된 예정 일정이 없습니다. 수동입력에서 학교 일정을 등록할 수 있습니다."}</p> : null}
      <div className={styles.months}>{months.map(month => <CollapsibleStatusSection key={currentMonth + ":" + month.month} headingLevel={3}
        title={(month.month.slice(0, 4) !== overview.today.slice(0, 4) ? month.month.slice(0, 4) + "년 " : "") + Number(month.month.slice(5)) + "월"}
        countLabel={`${month.clusters.reduce((sum, cluster) => sum + cluster.entries.length, 0) + month.pending.length}건`} defaultOpen={month.month === currentMonth}>
        <ol className={styles.timeline}>{month.clusters.map(cluster => <DateGroup key={cluster.startDate} cluster={cluster} highlighted={cluster === clusters[0]} student={student} canEdit={canEdit} />)}</ol>
        {month.pending.length ? <div className={styles.pending}><p className={styles.pendingLabel}>날짜 확인 필요</p><div className={styles.pendingEvents}>{month.pending.map(entry => <EventInfo key={entry.groupKey + "-" + entry.event.id} entry={entry} highlighted={false} student={student} canEdit={canEdit} />)}</div></div> : null}
        {!month.clusters.length && !month.pending.length ? <p className={styles.hint}>등록된 일정이 없습니다.</p> : null}
      </CollapsibleStatusSection>)}
      {pending.length ? <CollapsibleStatusSection title="날짜 확인 필요" headingLevel={3} countLabel={`${pending.length}건`} defaultOpen><div className={styles.pendingEvents}>{pending.map(entry => <EventInfo key={entry.groupKey + "-" + entry.event.id} entry={entry} highlighted={false} student={student} canEdit={canEdit} />)}</div></CollapsibleStatusSection> : null}</div>
    </>}
  </section>;
}
