import type { ReactNode } from "react";
import type { SchoolScheduleSummary } from "../contracts/school-schedule";
import { nearestSchoolExam } from "../domain/school-schedule";
import styles from "./school-schedule.module.css";

export function SchoolExamIdentity({ children, summary, refreshNeeded = false, as: Tag = "div" }: {
  children: ReactNode; summary?: SchoolScheduleSummary; refreshNeeded?: boolean; as?: "div" | "span";
}) {
  const next = summary && !refreshNeeded ? nearestSchoolExam(summary) : null;
  const unknownExam = summary?.events.some(event => event.kind === "written" && event.status !== "not-held" && !event.startDate);
  const label = refreshNeeded ? "일정 갱신 필요" : next?.label ?? (summary?.status === "error" ? "일정 확인 실패" : summary?.status === "unlinked" ? "학교 연결 필요" : summary?.status === "ready" ? unknownExam ? "시험 날짜 확인 중" : "예정 시험 없음" : summary?.status === "missing-profile" ? "학교·학년 미등록" : "일정 미등록");
  return <Tag className={styles.identityContainer}><Tag className={styles.identity}>
    {summary ? <span className={styles.countdown} data-urgent={next !== null && next.days <= 14}
      title={next ? `${next.exam.title} · ${next.exam.startDate}~${next.exam.endDate} · 학교 시험기간 첫날 기준` : label}>
      {label}
    </span> : null}
    <Tag className={styles.name}>{children}</Tag>
  </Tag></Tag>;
}
