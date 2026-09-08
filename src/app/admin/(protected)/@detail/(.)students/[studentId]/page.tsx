import { Suspense } from "react";

import { StudentDetailRouteContent } from "@/features/students/server/components/student-detail-route-content";
import { StudentDetailSkeleton } from "@/features/students/ui/student-detail-skeleton";

export default function InterceptedAdminStudentDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ studentId: string }>;
  searchParams?: Promise<{ tab?: string | string[] }>;
}) {
  return (
    <Suspense fallback={<StudentDetailSkeleton presentation="dialog" />}>
      <InterceptedAdminStudentDetailContent params={params} searchParams={searchParams} />
    </Suspense>
  );
}

async function InterceptedAdminStudentDetailContent({
  params,
  searchParams,
}: {
  params: Promise<{ studentId: string }>;
  searchParams?: Promise<{ tab?: string | string[] }>;
}) {
  const { studentId } = await params;
  return (
    <StudentDetailRouteContent
      presentation="dialog"
      studentId={studentId}
      searchParams={searchParams}
    />
  );
}
