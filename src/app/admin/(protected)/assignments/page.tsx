import type { Metadata } from "next";

import { AssignmentManager } from "@/components/assignment-manager";
import {
  listAssignments,
  listDatasets,
  listStudents,
} from "@/lib/services/admin-service";

export const metadata: Metadata = {
  title: "시험 배정",
};

export default async function AssignmentsPage() {
  const [datasets, students, assignments] = await Promise.all([
    listDatasets(),
    listStudents(),
    listAssignments(),
  ]);

  return (
    <>
      <div className="page-heading">
        <div>
          <p className="eyebrow">VOCAB ASSIGNMENTS</p>
          <h1>단어시험 배정</h1>
          <p>
            시험범위·시간·통과점수와 응시할 학생을 직접 정합니다.
          </p>
        </div>
      </div>
      <AssignmentManager
        assignments={assignments}
        datasets={datasets}
        students={students}
      />
    </>
  );
}
