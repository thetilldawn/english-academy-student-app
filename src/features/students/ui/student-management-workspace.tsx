"use client";

import { useStudentDetailController } from "../controller/use-student-detail-controller";
import type { StudentManagementData } from "../model";
import { StudentDetailDialog } from "./student-detail-dialog";
import { StudentDirectory } from "./student-directory";

export function StudentManagementWorkspace(data: StudentManagementData) {
  const controller = useStudentDetailController(data);
  return (
    <>
      <StudentDirectory controller={controller} data={data} />
      <StudentDetailDialog controller={controller} data={data} />
    </>
  );
}
