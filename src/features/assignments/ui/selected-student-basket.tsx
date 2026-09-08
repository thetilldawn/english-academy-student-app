import { Button } from "@/design-system/primitives/button/button";

import type { AssignmentSelectionStudent } from "../contracts/assignment-workspace-read-model";
import styles from "./assignment-workspace.module.css";

export function SelectedStudentBasket({
  students, busy, onClear, onToggle,
}: {
  students: readonly AssignmentSelectionStudent[];
  busy: boolean;
  onClear: () => void;
  onToggle: (student: AssignmentSelectionStudent) => void;
}) {
  return (
    <section aria-label="선택 바구니" className={styles.selectionBasket}>
      <div className={styles.selectionBasketHeading}>
        <strong aria-live="polite">선택 바구니 · {students.length}명</strong>
        <Button
          disabled={busy || students.length === 0}
          onClick={onClear}
          size="small"
          variant="quiet"
        >
          전체 해제
        </Button>
      </div>
      <div className={styles.selectionChips}>
        {students.length === 0 ? <span>배정할 학생을 선택해 주세요.</span> : null}
        {students.map((student) => (
          <Button
            aria-label={`${student.displayName} 선택 해제`}
            disabled={busy}
            key={student.id}
            onClick={() => onToggle(student)}
            size="small"
            variant="filter"
          >
            {student.displayName} ×
          </Button>
        ))}
      </div>
    </section>
  );
}
