import { RoutedDetailDialog } from "@/components/routed-detail-dialog";
import { commonText } from "@/content/ko/common";

import styles from "./student-detail.module.css";

export function StudentDetailSkeleton({ presentation }: { presentation: "dialog" | "page" }) {
  const skeleton = (
    <div
      aria-label="학생 상세 불러오는 중"
      className={presentation === "dialog" ? styles.dialogSkeleton : styles.pageSkeleton}
      role="status"
    >
      {presentation === "page" ? <span className={styles.skeletonTitle} /> : null}
      <span className={styles.skeletonTabs} />
      <span className={styles.skeletonBody} />
    </div>
  );

  if (presentation === "page") return skeleton;
  return (
    <RoutedDetailDialog
      closeLabel={commonText.modal.close}
      heading={<h2 id="student-detail-loading-title">학생 정보 불러오는 중…</h2>}
      height="medium"
      size="wide"
      titleId="student-detail-loading-title"
    >
      {skeleton}
    </RoutedDetailDialog>
  );
}
