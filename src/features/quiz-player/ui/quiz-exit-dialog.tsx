"use client";
import { Button } from "@/design-system/primitives/button/button";
import { DialogBody, DialogFooter, DialogFrame, DialogHeader } from "@/design-system/primitives/dialog/dialog";
import styles from "./quiz-player.module.css";

export function QuizExitDialog({ onContinue, onExit }: { onContinue: () => void; onExit: () => void }) {
  return <DialogFrame aria-labelledby="quiz-exit-title" aria-describedby="quiz-exit-description" size="compact"
    layout="body-footer" onRequestClose={onContinue} className={styles.exitDialog}>
    <DialogHeader closeLabel="시험 계속" showCloseButton={false}><h2 id="quiz-exit-title">시험을 중단할까요?</h2></DialogHeader>
    <DialogBody><p id="quiz-exit-description">작성한 답은 이 기기에 보관됩니다. 제한 시간은 계속 흐릅니다.</p></DialogBody>
    <DialogFooter className={styles.exitActions}>
      <Button onClick={onExit} variant="secondary">시험 중단</Button>
      <Button onClick={onContinue} variant="primary" autoFocus>시험 계속</Button>
    </DialogFooter>
  </DialogFrame>;
}
