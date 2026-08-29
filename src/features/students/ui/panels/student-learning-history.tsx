"use client";

import { useState } from "react";

import { formatContentText } from "@/content/format";
import { adminStudentsText } from "@/content/ko/admin-students";
import { Button } from "@/design-system/primitives/button/button";
import { Select } from "@/design-system/primitives/form/field";
import { Notice } from "@/design-system/patterns/feedback/feedback";
import { StudentLearningActivityList } from "@/features/history/ui/student-learning-activity-list";

import type { StudentHistoryPageController } from "../../controller/use-student-history-page";
import styles from "../student-detail.module.css";

type Period = "all" | "30" | "90" | "365";

function sinceForPeriod(period: Period) {
  if (period === "all") return null;
  return new Date(Date.now() - Number(period) * 86_400_000).toISOString();
}

export function StudentLearningHistory({
  controller,
}: {
  controller: StudentHistoryPageController;
}) {
  const [period, setPeriod] = useState<Period>("all");
  return (
    <div className={styles.learningHistory} aria-busy={controller.filtering}>
      <div
        aria-label={adminStudentsText.learning.activityList.filterAria}
        className={styles.historyFilters}
      >
        <label>
          <span>{adminStudentsText.learning.activityList.filters.type}</span>
          <Select
            onChange={(event) => void controller.actions.replaceFilters({
              ...controller.filters,
              purpose: event.target.value as typeof controller.filters.purpose,
            })}
            value={controller.filters.purpose}
          >
            <option value="all">{adminStudentsText.learning.activityList.filters.allTypes}</option>
            <option value="regular">{adminStudentsText.learning.activityList.filters.regular}</option>
            <option value="mixed">{adminStudentsText.learning.activityList.filters.mixed}</option>
            <option value="review">{adminStudentsText.learning.activityList.filters.review}</option>
          </Select>
        </label>
        <label>
          <span>{adminStudentsText.learning.activityList.filters.status}</span>
          <Select
            onChange={(event) => void controller.actions.replaceFilters({
              ...controller.filters,
              section: event.target.value as typeof controller.filters.section,
            })}
            value={controller.filters.section}
          >
            <option value="all">{adminStudentsText.learning.activityList.filters.allStatuses}</option>
            <option value="open">{adminStudentsText.learning.activityList.filters.open}</option>
            <option value="needs_attention">{adminStudentsText.learning.activityList.filters.needsAttention}</option>
            <option value="completed">{adminStudentsText.learning.activityList.filters.completed}</option>
            <option value="archived">{adminStudentsText.learning.activityList.filters.archived}</option>
          </Select>
        </label>
        <label>
          <span>{adminStudentsText.learning.activityList.filters.period}</span>
          <Select
            onChange={(event) => {
              const nextPeriod = event.target.value as Period;
              setPeriod(nextPeriod);
              void controller.actions.replaceFilters({
                ...controller.filters,
                since: sinceForPeriod(nextPeriod),
              });
            }}
            value={period}
          >
            <option value="all">{adminStudentsText.learning.activityList.filters.allPeriods}</option>
            <option value="30">{adminStudentsText.learning.activityList.filters.recent30}</option>
            <option value="90">{adminStudentsText.learning.activityList.filters.recent90}</option>
            <option value="365">{adminStudentsText.learning.activityList.filters.recentYear}</option>
          </Select>
        </label>
      </div>
      <div className={styles.historySummary} aria-live="polite">
        <strong>
          {formatContentText(adminStudentsText.learning.activityList.count, {
            count: controller.page.totalCount,
          })}
        </strong>
        <span>{controller.filtering ? adminStudentsText.page.filtering : ""}</span>
      </div>
      {controller.error ? <Notice role="alert" tone="danger">{controller.error}</Notice> : null}
      <StudentLearningActivityList
        includeArchived
        initialLimit={10}
        items={controller.page.items}
        showFilters={false}
      />
      {controller.page.nextCursor ? (
        <Button
          className={styles.historyMore}
          disabled={controller.filtering || controller.loadingMore}
          onClick={() => void controller.actions.loadMore()}
          variant="quiet"
        >
          {controller.loadingMore
            ? adminStudentsText.learning.activityList.loadingMore
            : adminStudentsText.learning.activityList.loadMore}
        </Button>
      ) : null}
    </div>
  );
}
