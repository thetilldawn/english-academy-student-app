import { notFound } from "next/navigation";
import { requireStudentSession } from "@/lib/auth/student-session";
import type { StudyPresentation } from "../../contracts/assignment-study";
import { AssignmentStudyReader } from "../../client/components/assignment-study-reader";
import { getAssignmentStudy } from "../queries/assignment-study-query";

export async function AssignmentStudyContent({ params, presentation }: {
  params: Promise<{ id: string }>;
  presentation: StudyPresentation;
}) {
  const student = await requireStudentSession();
  const { id } = await params;
  const study = await getAssignmentStudy(student, id);
  if (!study) notFound();
  return <AssignmentStudyReader key={`${study.assignmentId}:${study.mode}`} presentation={presentation} study={study} />;
}
