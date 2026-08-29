import styles from "./student-dashboard.module.css";

export function StudentDashboardSkeleton() {
  return (
    <main
      aria-busy="true"
      aria-label="학생 시험 목록을 불러오는 중"
      className={styles.page}
      id="main-content"
    >
      <div className={styles.skeletonPoint} />
      <div className={styles.skeletonSection} />
      <div className={styles.skeletonSection} />
    </main>
  );
}
