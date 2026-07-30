import type { Metadata } from "next";

import { StudentManager } from "@/components/student-manager";
import { getServerEnvironment } from "@/lib/env";
import {
  buildStudentProgress,
  listAssignmentHistory,
  listSelectableDatasets,
  listStudents,
  listVocabUnits,
} from "@/lib/services/admin-service";

export const metadata: Metadata = {
  title: "학생 관리",
};

export default async function StudentsPage({
  searchParams,
}: {
  searchParams: Promise<{ student?: string }>;
}) {
  const [
    { student: initialStudentId = "" },
    students,
    datasets,
    units,
    history,
  ] = await Promise.all([
    searchParams,
    listStudents(),
    listSelectableDatasets(),
    listVocabUnits(),
    listAssignmentHistory(),
  ]);
  const progress = buildStudentProgress(students, units, history);
  const appOrigin =
    getServerEnvironment().APP_ORIGIN ?? "http://localhost:3000";

  return (
    <>
      <div className="page-heading admin-page-heading">
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
        appOrigin={appOrigin}
        datasets={datasets}
        history={history}
        initialStudentId={initialStudentId}
        progress={progress}
        students={students}
      />
    </>
  );
}
