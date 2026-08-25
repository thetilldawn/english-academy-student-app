import { learningPointsText } from "@/content/ko/learning-points";

import type {
  AdminAttemptPointSummary,
  StudentAttemptPointSummary,
} from "../model";
import {
  formatPointChange,
  formatVisiblePoints,
} from "../presentation/point-presentation";
import styles from "./point-summary.module.css";

type PointItem = {
  label: string;
  value: string;
};

function PointValueList({
  ariaLabel,
  items,
  variant,
}: {
  ariaLabel: string;
  items: readonly PointItem[];
  variant: "current" | "student-attempt" | "admin-attempt";
}) {
  const values = items.map((item) => (
    <div key={item.label}>
      <dt>{item.label}</dt>
      <dd>{item.value}</dd>
    </div>
  ));

  return (
    <dl
      aria-label={ariaLabel}
      className={styles.list}
      data-point-summary={variant}
    >
      {values}
    </dl>
  );
}

export function CurrentPointSummary({
  currentPoints,
}: {
  currentPoints: number;
}) {
  return (
    <PointValueList
      ariaLabel={learningPointsText.current}
      items={[{
        label: learningPointsText.current,
        value: formatVisiblePoints(currentPoints),
      }]}
      variant="current"
    />
  );
}

export function StudentAttemptPointSummaryView({
  summary,
}: {
  summary: StudentAttemptPointSummary;
}) {
  return (
    <PointValueList
      ariaLabel={learningPointsText.studentAttempt.aria}
      items={[
        {
          label: learningPointsText.studentAttempt.earned,
          value: formatVisiblePoints(summary.attemptPoints),
        },
        {
          label: learningPointsText.current,
          value: formatVisiblePoints(summary.currentPoints),
        },
      ]}
      variant="student-attempt"
    />
  );
}

export function AdminAttemptPointSummaryView({
  summary,
}: {
  summary: AdminAttemptPointSummary;
}) {
  return (
    <PointValueList
      ariaLabel={learningPointsText.adminAttempt.aria}
      items={[
        {
          label: learningPointsText.adminAttempt.correctReward,
          value: formatPointChange(summary.correctReward),
        },
        {
          label: learningPointsText.adminAttempt.wrongEffect,
          value: formatPointChange(summary.wrongEffect),
        },
        {
          label: learningPointsText.adminAttempt.netChange,
          value: formatPointChange(summary.netChange),
        },
        {
          label: learningPointsText.current,
          value: formatVisiblePoints(summary.currentPoints),
        },
      ]}
      variant="admin-attempt"
    />
  );
}
