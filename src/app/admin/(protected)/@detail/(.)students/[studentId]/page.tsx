import { StudentDetailRouteContent } from "@/features/students/server/components/student-detail-route-content";

export default async function InterceptedAdminStudentDetailPage({
  params,
}: {
  params: Promise<{ studentId: string }>;
}) {
  const { studentId } = await params;
  return (
    <StudentDetailRouteContent
      presentation="dialog"
      studentId={studentId}
    />
  );
}
