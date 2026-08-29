import styles from "./student-directory.module.css";

export function StudentDirectorySkeleton() {
  return (
    <div aria-hidden="true" className={styles.skeleton}>
      <span />
      <span />
      <span />
    </div>
  );
}
