import { MetaTag } from "@/design-system/primitives/badge/badge";
import { Button } from "@/design-system/primitives/button/button";
import { formatKoreanDateTime } from "@/lib/format";

import type { VocabCollisionDecisionRecord } from "../domain/vocab-collision-decisions";
import type { VocabRangeDistribution } from "../domain/vocab-assignment-contract";
import styles from "./vocab-assignment-planner.module.css";

const decisionLabels = {
  allow: "겹침 허용",
  move: "다음 날 이동",
  skip: "건너뜀",
} as const;

export function CollisionDecisionList({
  decisions,
  distribution,
  onChange,
  onClear,
}: {
  decisions: readonly VocabCollisionDecisionRecord[];
  distribution: VocabRangeDistribution;
  onChange: (
    collisionId: string,
    mode: "skip" | "move" | "allow",
  ) => void;
  onClear: (collisionId: string) => void;
}) {
  if (decisions.length === 0) return null;

  return (
    <section aria-label="겹침 처리 결정" className={styles.decisionArea}>
      <strong>겹침 처리 {decisions.length}건</strong>
      <div className={styles.decisionList} role="list">
        {decisions.map((record) => {
          const mode = record.decision.mode;
          return (
            <article
              className={styles.decisionCard}
              key={record.decision.collisionId}
              role="listitem"
            >
              <div className={styles.decisionHeading}>
                <strong>{record.studentName} · 원래 {record.sourceSessionNumber}회</strong>
                <MetaTag tone="warning">{decisionLabels[mode]}</MetaTag>
              </div>
              <span>
                {record.unitLabel ?? "범위 확인 필요"} · 공개 {formatKoreanDateTime(record.availableFrom)}
                {record.availableUntil
                  ? ` · 마감 ${formatKoreanDateTime(record.availableUntil)}`
                  : ""}
              </span>
              <small>{record.warningMessage}</small>
              {distribution === "split" && mode === "skip" ? (
                <small className={styles.omissionWarning}>
                  {record.unitLabel ?? "이 회차 범위"}는 이번 배정에서 빠지며 다음 회차에 자동으로 합쳐지지 않습니다.
                </small>
              ) : null}
              <div className={styles.warningActions}>
                <Button
                  aria-label={`${record.studentName} 원래 ${record.sourceSessionNumber}회 건너뜀`}
                  aria-pressed={mode === "skip"}
                  onClick={() => onChange(record.decision.collisionId, "skip")}
                  size="small"
                  variant="quiet"
                >
                  건너뜀
                </Button>
                {record.availableUntil ? (
                  <Button
                    aria-label={`${record.studentName} 원래 ${record.sourceSessionNumber}회 ${mode === "move" ? "하루 더 이동" : "다음 날 이동"}`}
                    aria-pressed={mode === "move"}
                    onClick={() => onChange(record.decision.collisionId, "move")}
                    size="small"
                  >
                    {mode === "move" ? "하루 더 이동" : "다음 날 이동"}
                  </Button>
                ) : null}
                <Button
                  aria-label={`${record.studentName} 원래 ${record.sourceSessionNumber}회 ${mode === "move" ? "원래 날짜 겹침 허용" : "겹침 허용"}`}
                  aria-pressed={mode === "allow"}
                  onClick={() => onChange(record.decision.collisionId, "allow")}
                  size="small"
                  variant="filter"
                >
                  {mode === "move" ? "원래 날짜 겹침 허용" : "겹침 허용"}
                </Button>
                <Button
                  aria-label={`${record.studentName} 원래 ${record.sourceSessionNumber}회 되돌리기`}
                  onClick={() => onClear(record.decision.collisionId)}
                  size="small"
                  variant="quiet"
                >
                  되돌리기
                </Button>
              </div>
            </article>
          );
        })}
      </div>
    </section>
  );
}
