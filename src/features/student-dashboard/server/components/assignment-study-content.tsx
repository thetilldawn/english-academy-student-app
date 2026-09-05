import { notFound } from "next/navigation";
import { requireStudentSession } from "@/lib/auth/student-session";
import type { StudyPresentation } from "../../contracts/assignment-study";
import { AssignmentStudyFrame } from "../../ui/assignment-study-frame";
import { AssignmentStudyWords } from "../../ui/assignment-study-words";
import { getAssignmentStudy } from "../queries/assignment-study-query";

export async function AssignmentStudyContent({ params, presentation }: {
  params: Promise<{ id: string }>;
  presentation: StudyPresentation;
}) {
  const student = await requireStudentSession();
  const { id } = await params;
  const study = await getAssignmentStudy(student, id);
  if (!study) notFound();
  return <AssignmentStudyFrame presentation={presentation} title={study.title}>
    <AssignmentStudyWords key={study.assignmentId} study={study} />
  </AssignmentStudyFrame>;
}
