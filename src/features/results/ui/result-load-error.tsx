"use client";

import { studentAppText } from "@/content/ko/student-app";
import { Button } from "@/design-system/primitives/button/button";
import styles from "./result-layout.module.css";

export function ResultLoadError({ retry }: { retry: () => void }) {
  return <main className={styles.page} id="main-content">
    <section role="alert">
      <h2>{studentAppText.result.metadataTitle}</h2>
      <p>{studentAppText.result.loadError}</p>
      <Button onClick={retry}>{studentAppText.study.retry}</Button>
    </section>
  </main>;
}
