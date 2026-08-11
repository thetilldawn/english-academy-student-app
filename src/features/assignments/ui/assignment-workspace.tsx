"use client";

import { toast } from "sonner";

import { formatContentText } from "@/content/format";
import { adminLearningText } from "@/content/ko/admin-learning";
import { Tabs } from "@/design-system/primitives/tabs/tabs";
import type { AssignmentManagerData } from "@/lib/services/assignment-manager-data";

import {
  useAssignmentWorkspace,
  type AssignmentDialogView,
} from "../controller/use-assignment-workspace";
import { AssignmentStudentBrowser } from "./assignment-student-browser";
import { AssignmentStudentDialog } from "./assignment-student-dialog";
import { BulkAssignmentEditor } from "./bulk-assignment-editor";
import styles from "./assignment-workspace.module.css";

export function AssignmentWorkspace({
  data,
  initialDatasetId = "",
  initialDialogView = "overview",
  initialStudentId = "",
}: {
  data: AssignmentManagerData;
  initialDatasetId?: string;
  initialDialogView?: AssignmentDialogView;
  initialStudentId?: string;
}) {
  const controller = useAssignmentWorkspace({
    data,
    initialDatasetId,
    initialDialogView,
    initialStudentId,
  });

  return (
    <>
      <Tabs
        ariaLabel={adminLearningText.page.tabsAria}
        className={styles.tabs}
        items={[
          {
            value: "vocab",
            label: adminLearningText.page.vocabularyTab,
            controls: "vocabulary-learning-panel",
            id: "vocabulary-learning-tab",
          },
          {
            value: "other",
            label: adminLearningText.page.otherLearningTab,
            controls: "other-learning-panel",
            id: "other-learning-tab",
          },
        ]}
        onChange={controller.actions.setTestTab}
        value={controller.testTab}
      />

      {controller.testTab === "other" ? (
        <section
          aria-labelledby="other-learning-tab"
          className={styles.placeholder}
          id="other-learning-panel"
          role="tabpanel"
        >
          {adminLearningText.page.otherLearningEmpty}
        </section>
      ) : (
        <AssignmentStudentBrowser controller={controller} />
      )}

      {controller.bulkMode && controller.selectedBulkStudents.length > 0 ? (
        <BulkAssignmentEditor
          includePendingReview={controller.bulkMode === "with_wrong"}
          onClose={() => controller.actions.setBulkMode(null)}
          onSuccess={(assignmentCount) => {
            const studentCount = controller.selectedBulkStudents.length;
            controller.actions.clearBulkStudents();
            toast.success(
              formatContentText(adminLearningText.page.bulk.success, {
                assignmentCount,
                studentCount,
              }),
            );
            controller.actions.refresh();
          }}
          students={controller.selectedBulkStudents}
        />
      ) : null}

      <AssignmentStudentDialog controller={controller} />
    </>
  );
}
