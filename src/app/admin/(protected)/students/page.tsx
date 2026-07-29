import type { Metadata } from "next";

import { StudentManager } from "@/components/student-manager";
import {
  listSelectableDatasets,
  listStudentProgress,
  listStudents,
  listVocabUnits,
} from "@/lib/services/admin-service";

export const metadata: Metadata = {
  title: "학생 관리",
};

export default async function StudentsPage() {
  const [students, datasets, units] = await Promise.all([
    listStudents(),
    listSelectableDatasets(),
    listVocabUnits(),
  ]);
  const progress = await listStudentProgress(students, units);

  return (
    <>
      <div className="page-heading">
        <div>
          <p className="eyebrow">STUDENT MANAGEMENT</p>
          <h1>학생 관리</h1>
          <p>
            학생의 현재 단어장과 시험을 관리하고, 접속 코드를
            보내거나 즉시 차단합니다.
          </p>
        </div>
      </div>
      <StudentManager
        datasets={datasets}
        progress={progress}
        students={students}
      />
    </>
  );
}
