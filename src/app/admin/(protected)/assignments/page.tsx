import type { Metadata } from "next";

import { AssignmentManager } from "@/components/assignment-manager";
import {
  buildStudentProgress,
  listAssignmentHistory,
  listDatasets,
  listStudents,
  listVocabUnits,
} from "@/lib/services/admin-service";

export const metadata: Metadata = {
  title: "시험 관리",
};

export default async function AssignmentsPage({
  searchParams,
}: {
  searchParams: Promise<{ student?: string }>;
}) {
  const [
    { student: initialStudentId = "" },
    datasets,
    students,
    units,
    history,
  ] = await Promise.all([
    searchParams,
    listDatasets(),
    listStudents(),
    listVocabUnits(),
    listAssignmentHistory(),
  ]);
  const progress = buildStudentProgress(students, units, history);

  return (
    <>
      <div className="page-heading admin-page-heading">
        <div>
          <p className="eyebrow">TEST MANAGEMENT</p>
          <h1>시험 관리</h1>
          <p>
            학생을 찾고 최근 상태를 확인한 뒤 필요한 시험을
            배정합니다.
          </p>
        </div>
      </div>
      <AssignmentManager
        datasets={datasets}
        students={students}
        units={units}
        progress={progress}
        initialStudentId={initialStudentId}
      />
    </>
  );
}
