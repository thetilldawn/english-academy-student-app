import type { Metadata } from "next";

import { AdminBreadcrumb } from "@/components/admin-breadcrumb";
import { loadStudentManagementData } from "@/features/students/server/load-student-management-data";
import { StudentManagementWorkspace } from "@/features/students/ui/student-management-workspace";
import { adminStudentsText } from "@/content/ko/admin-students";

export const metadata: Metadata = {
  title: adminStudentsText.page.title,
};

export default async function StudentsPage({
  searchParams,
}: {
  searchParams: Promise<{ student?: string }>;
}) {
  const [{ student: initialStudentId = "" }, data] = await Promise.all([
    searchParams,
    loadStudentManagementData(),
  ]);

  return (
    <>
      <AdminBreadcrumb current={adminStudentsText.page.title} />
      <StudentManagementWorkspace
        {...data}
        initialStudentId={initialStudentId}
      />
    </>
  );
}
