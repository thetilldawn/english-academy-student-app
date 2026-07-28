import type { Metadata } from "next";

import { StudentManager } from "@/components/student-manager";
import {
  listSelectableDatasets,
  listStudents,
} from "@/lib/services/admin-service";

export const metadata: Metadata = {
  title: "학생과 접속코드",
};

export default async function StudentsPage() {
  const [students, datasets] = await Promise.all([
    listStudents(),
    listSelectableDatasets(),
  ]);

  return (
    <>
      <div className="page-heading">
        <div>
          <p className="eyebrow">STUDENTS & ACCESS</p>
          <h1>학생과 접속코드</h1>
          <p>
            회원가입 없이 학생을 만들고, 코드를 교체하거나 즉시
            차단합니다.
          </p>
        </div>
      </div>
      <StudentManager datasets={datasets} students={students} />
    </>
  );
}
