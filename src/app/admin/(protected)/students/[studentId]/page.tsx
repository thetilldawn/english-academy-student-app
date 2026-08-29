import type { Metadata } from "next";

import { StudentDetailRouteContent } from "@/features/students/server/components/student-detail-route-content";

export const metadata: Metadata = {
  title: "학생 상세",
};

export default async function AdminStudentDetailPage({
  params,
}: {
  params: Promise<{ studentId: string }>;
}) {
  const { studentId } = await params;
  return (
    <StudentDetailRouteContent
      presentation="page"
      studentId={studentId}
    />
  );
}
