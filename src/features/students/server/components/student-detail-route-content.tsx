import { notFound } from "next/navigation";
import { z } from "zod";

import { getAppOrigin } from "@/lib/env";

import type { StudentDetailPresentation } from "../../ui/student-detail-content";
import { StudentDetailDialog } from "../../ui/student-detail-dialog";
import { StudentDetailPage } from "../../ui/student-detail-page";
import { getStudentDetailInitial } from "../queries/student-detail-query";

export async function StudentDetailRouteContent({
  presentation,
  studentId,
  searchParams,
}: {
  presentation: StudentDetailPresentation;
  studentId: string;
  searchParams?: Promise<{ tab?: string | string[] }>;
}) {
  const parsedId = z.uuid().safeParse(studentId);
  if (!parsedId.success) notFound();

  const initial = await getStudentDetailInitial(parsedId.data);
  if (!initial) notFound();
  const params = await searchParams;
  const initialTab = params?.tab === "history" ? "history" as const : "info" as const;
  const props = { appOrigin: getAppOrigin(), initial, initialTab };

  return presentation === "dialog"
    ? <StudentDetailDialog {...props} key={initial.student.id} />
    : <StudentDetailPage {...props} key={initial.student.id} />;
}
