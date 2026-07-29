import type { Metadata } from "next";

import { AssignmentManager } from "@/components/assignment-manager";
import {
  listAssignments,
  listDatasets,
  listStudentProgress,
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
    assignments,
    units,
  ] = await Promise.all([
    searchParams,
    listDatasets(),
    listStudents(),
    listAssignments(),
    listVocabUnits(),
  ]);
  const progress = await listStudentProgress(students, units);

  return (
    <>
      <div className="page-heading">
        <div>
          <p className="eyebrow">TEST MANAGEMENT</p>
          <h1>단어 시험 배정</h1>
          <p>
            학생과 DAY 범위를 정하면 문제은행을 한 번 만들고,
            학생마다 정해진 순서로 빠르게 응시합니다.
          </p>
        </div>
      </div>
      <AssignmentManager
        assignments={assignments}
        datasets={datasets}
        students={students}
        units={units}
        progress={progress}
        initialStudentId={initialStudentId}
      />
    </>
  );
}
