import { Button } from "@/design-system/primitives/button/button";

import type { AssignmentWorkspaceController } from "../controller/use-assignment-workspace";
import styles from "./assignment-workspace.module.css";

export function SelectedStudentBasket({
  controller,
}: {
  controller: AssignmentWorkspaceController;
}) {
  if (controller.selectedBulkStudents.length === 0) return null;
  return (
    <section aria-label="선택 바구니" className={styles.selectionBasket}>
      <div className={styles.selectionBasketHeading}>
        <strong>선택 바구니 · {controller.selectedBulkStudents.length}명</strong>
        <Button
          onClick={controller.actions.clearBulkStudents}
          size="small"
          variant="quiet"
        >
          전체 해제
        </Button>
      </div>
      <div className={styles.selectionChips}>
        {controller.selectedBulkStudents.map((student) => (
          <Button
            aria-label={`${student.displayName} 선택 해제`}
            key={student.id}
            onClick={() => controller.actions.toggleBulkStudent(student.id)}
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
