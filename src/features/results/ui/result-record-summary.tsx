import { formatContentText } from "@/content/format";
import { resultRecordText as copy } from "@/content/ko/result-record";
import { StatusBadge } from "@/design-system/primitives/badge/badge";
import { formatKoreanDateTime } from "@/lib/format";
import type { VocabularyResultRecord } from "../contracts/result-record";
import styles from "./result-record-summary.module.css";

export function ResultRecordSummary({ record }: { record: VocabularyResultRecord }) {
  const pending = record.state === "initial_in_progress" ? copy.initialRunning
    : record.state === "retry_waiting" ? copy.waiting
    : record.state === "retry_in_progress" ? copy.retryRunning : null;

  return (
    <section aria-label={copy.title} className={styles.summary}>
      <h2>{copy.title}</h2>
      <StatusBadge tone={record.state === "completed" ? "success" : record.finalized ? "danger" : "neutral"}>
        {copy.state[record.state]}
      </StatusBadge>
      {pending ? <p className={styles.notice}>{pending}</p> : null}
      {record.finalReason === "student_deleted" ? <p className={styles.notice}>{copy.studentDeleted}</p> : null}
      {record.phases.map(phase => (
        <div className={styles.phase} key={phase.phase}>
          <h3>{phase.phase === "initial" ? copy.initial : copy.retry}</h3>
          <p>{formatContentText(copy.counts, { total: phase.targetCount, correct: phase.correctCount,
            wrong: phase.wrongCount, unanswered: phase.unansweredCount })}</p>
          <dl>
            <div><dt>{phase.phase === "initial" ? copy.initialScore : copy.finalScore}</dt>
              <dd>{phase.score === null ? "-" : `${phase.score}점`} · {phase.passed === null ? copy.unknownPass : phase.passed ? copy.passed : copy.failed}</dd></div>
            <div><dt>{copy.started}</dt><dd>{phase.startedAt ? formatKoreanDateTime(phase.startedAt) : copy.unknownTime}</dd></div>
            <div><dt>{copy.ended}</dt><dd>{phase.endedAt ? formatKoreanDateTime(phase.endedAt) : copy.unknownTime}</dd></div>
          </dl>
          {phase.endReason === "expired" ? <p>{copy.expired}</p> : null}
        </div>
      ))}
      {record.detailScope === "summary_only" ? <p className={styles.notice}>{copy.summaryOnly}</p>
        : record.retentionPolicy === "summary_and_mistakes_v1" ? <p className={styles.notice}>{copy.compact}</p> : null}
    </section>
  );
}
