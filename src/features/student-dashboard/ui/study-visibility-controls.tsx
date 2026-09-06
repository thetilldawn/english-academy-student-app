import { studentAppText } from "@/content/ko/student-app";
import { Button } from "@/design-system/primitives/button/button";
import styles from "./assignment-study.module.css";

export function StudyVisibilityControls({ englishHidden, meaningHidden, canHideMeaning, onToggleEnglish, onToggleMeaning }: {
  englishHidden: boolean;
  meaningHidden: boolean;
  canHideMeaning: boolean;
  onToggleEnglish: () => void;
  onToggleMeaning: () => void;
}) {
  const text = studentAppText.study;
  return <div className={styles.controls} role="group" aria-label={text.visibilityLabel}>
    <Button variant="filter" size="small" aria-pressed={englishHidden} onClick={onToggleEnglish}>{text.hideEnglish}</Button>
    {canHideMeaning ? <Button variant="filter" size="small" aria-pressed={meaningHidden} onClick={onToggleMeaning}>{text.hideMeaning}</Button> : null}
  </div>;
}
