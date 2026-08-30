"use client";

import { useRouter } from "next/navigation";
import { toast } from "sonner";

import { adminLearningText } from "@/content/ko/admin-learning";
import { formatContentText } from "@/content/format";
import { MetaTag, MetaTagList } from "@/design-system/primitives/badge/badge";
import { Button } from "@/design-system/primitives/button/button";
import {
  DialogBody,
  DialogFooter,
  DialogFrame,
  DialogHeader,
} from "@/design-system/primitives/dialog/dialog";
import type { ReviewAssignmentDraftSummary } from "@/lib/admin/review-assignment";
import { formatKoreanDateTime } from "@/lib/format";

import { useLegacyReviewRecovery } from "../controller/use-legacy-review-recovery";
import styles from "./legacy-review-recovery.module.css";

export function LegacyReviewRecovery({
  draft,
}: {
  draft: ReviewAssignmentDraftSummary;
}) {
  const router = useRouter();
  const controller = useLegacyReviewRecovery({
    draft: {
      kind: "legacy_review_recovery",
      reviewDraftId: draft.id,
      studentId: draft.studentId,
    },
    errorMessage: adminLearningText.reviewAssignmentModal.cancelError,
  });

  function close() {
    if (!controller.busy) router.replace("/admin/assignments");
  }

  async function recover(destination: "list" | "assignment") {
    const outcome = await controller.recover();
    if (!outcome.ok) {
      toast.error(outcome.message);
      return;
    }
    toast.success(
      destination === "assignment"
        ? adminLearningText.reviewAssignmentModal.continueSuccess
        : adminLearningText.reviewAssignmentModal.cancelSuccess,
    );
    if (destination === "assignment") {
      const params = new URLSearchParams({
        dataset: draft.datasetId,
        student: draft.studentId,
        view: "assign",
      });
      router.replace(`/admin/assignments?${params.toString()}`);
    } else {
      router.replace("/admin/assignments");
    }
  }

  return (
    <DialogFrame
      aria-labelledby="legacy-review-recovery-title"
      closeDisabled={controller.busy}
      fullScreenMobile
      height="auto"
      layout="body-footer"
      onRequestClose={close}
      size="wide"
    >
      <DialogHeader closeLabel={adminLearningText.assignmentModal.header.close}>
        <div>
          <h2 id="legacy-review-recovery-title">
            {adminLearningText.reviewAssignmentModal.title}
          </h2>
          <p>
            {[draft.studentName, draft.schoolName, draft.gradeLabel]
              .filter(Boolean)
              .join(" · ")}
          </p>
        </div>
      </DialogHeader>
      <DialogBody>
        <section className={styles.summary}>
          <MetaTagList className={styles.context}>
            <MetaTag>{draft.datasetLabel}</MetaTag>
            <MetaTag tone="warning">
              {formatContentText(
                adminLearningText.reviewAssignmentModal.selectedWrongCount,
                { count: draft.questionCount },
              )}
            </MetaTag>
          </MetaTagList>
          <p className={styles.notice}>
            {adminLearningText.reviewAssignmentModal.recoveryHelp}
          </p>
          <dl className={styles.details}>
            <div>
              <dt>{adminLearningText.reviewAssignmentModal.student}</dt>
              <dd>{draft.studentName}</dd>
            </div>
            <div>
              <dt>{adminLearningText.reviewAssignmentModal.dataset}</dt>
              <dd>{draft.datasetLabel}</dd>
            </div>
            <div>
              <dt>{adminLearningText.reviewAssignmentModal.expiresLabel}</dt>
              <dd>{formatKoreanDateTime(draft.expiresAt)}</dd>
            </div>
          </dl>
          {controller.message ? (
            <p className={styles.error} role="alert">
              {controller.message}
            </p>
          ) : null}
        </section>
      </DialogBody>
      <DialogFooter>
        <Button
          disabled={controller.busy}
          onClick={() => void recover("list")}
          variant="quiet"
        >
          {controller.busy
            ? adminLearningText.reviewAssignmentModal.recovering
            : adminLearningText.reviewAssignmentModal.cancelDraft}
        </Button>
        <Button
          disabled={controller.busy}
          onClick={() => void recover("assignment")}
          size="large"
          variant="primary"
        >
          {controller.busy
            ? adminLearningText.reviewAssignmentModal.recovering
            : adminLearningText.reviewAssignmentModal.continueAssignment}
        </Button>
      </DialogFooter>
    </DialogFrame>
  );
}
