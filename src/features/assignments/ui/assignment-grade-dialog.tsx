import { Button } from "@/design-system/primitives/button/button";
import { DialogBody, DialogFooter, DialogFrame, DialogHeader } from "@/design-system/primitives/dialog/dialog";
import styles from "./vocab-assignment-planner.module.css";

export function AssignmentGradeDialog({
  datasetGrade, students, unknownCount, busy, onCancel, onExclude, onInclude,
}: {
  datasetGrade: string | null;
  students: readonly { studentId: string; displayName: string; gradeLabel: string | null }[];
  unknownCount: number;
  busy: boolean;
  onCancel: () => void;
  onExclude: () => void;
  onInclude: () => void;
}) {
  return <DialogFrame aria-labelledby="assignment-grade-title" aria-describedby="assignment-grade-description"
    closeDisabled={busy} layout="body-footer" onRequestClose={onCancel} role="alertdialog" size="compact">
    <DialogHeader closeLabel="돌아가기" showCloseButton={false}>
      <h2 id="assignment-grade-title">학년이 다른 학생이 있습니다</h2>
    </DialogHeader>
    <DialogBody>
      <p id="assignment-grade-description">선택한 단어장은 {datasetGrade ?? "학년 미입력"} 자료입니다. 아래 학생도 이 단어장 기준으로 배정할까요?</p>
      <ul className={styles.gradeStudents}>
        {students.map(student => <li key={student.studentId}>
          <strong>{student.displayName}</strong><span>{student.gradeLabel ?? "학년 미입력"}</span>
        </li>)}
      </ul>
      {unknownCount > 0 ? <p>학년을 비교할 수 없는 학생 {unknownCount}명은 그대로 포함됩니다.</p> : null}
    </DialogBody>
    <DialogFooter>
      <Button disabled={busy} onClick={onCancel}>돌아가기</Button>
      <Button disabled={busy} onClick={onExclude}>제외하기</Button>
      <Button disabled={busy} onClick={onInclude} variant="primary">포함하기</Button>
    </DialogFooter>
  </DialogFrame>;
}
