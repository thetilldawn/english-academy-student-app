import type { Metadata } from "next";
import { Suspense } from "react";

import { StudentDetailRouteContent } from "@/features/students/server/components/student-detail-route-content";
import { StudentDetailSkeleton } from "@/features/students/ui/student-detail-skeleton";

export const metadata: Metadata = {
  title: "학생 상세",
};

export default function AdminStudentDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ studentId: string }>;
  searchParams?: Promise<{ tab?: string | string[] }>;
}) {
  return (
    <Suspense fallback={<StudentDetailSkeleton presentation="page" />}>
      <AdminStudentDetailContent params={params} searchParams={searchParams} />
    </Suspense>
  );
}

async function AdminStudentDetailContent({
  params,
  searchParams,
}: {
  params: Promise<{ studentId: string }>;
  searchParams?: Promise<{ tab?: string | string[] }>;
}) {
  const { studentId } = await params;
  return (
    <StudentDetailRouteContent
      presentation="page"
      studentId={studentId}
      searchParams={searchParams}
    />
  );
}
