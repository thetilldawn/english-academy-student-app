import { Suspense } from "react";

import { StudentDetailRouteContent } from "@/features/students/server/components/student-detail-route-content";
import { StudentDetailSkeleton } from "@/features/students/ui/student-detail-skeleton";

export default function InterceptedAdminStudentDetailPage({
  params,
}: {
  params: Promise<{ studentId: string }>;
}) {
  return (
    <Suspense fallback={<StudentDetailSkeleton presentation="dialog" />}>
      <InterceptedAdminStudentDetailContent params={params} />
    </Suspense>
  );
}

async function InterceptedAdminStudentDetailContent({
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
