import { notFound } from "next/navigation";
import { requireStudentSession } from "@/lib/auth/student-session";
import type { StudyPresentation } from "../../contracts/assignment-study";
import { AssignmentStudyReader } from "../../client/components/assignment-study-reader";
import { getAssignmentStudy } from "../queries/assignment-study-query";
import { AssignmentStudyFrame } from "../../ui/assignment-study-frame";
import { assignmentReleaseNotice } from "@/lib/assignment/assignment-release";
import { AssignmentBoundaryRefresh } from "../../ui/assignment-boundary-refresh";
import { currentTimeMilliseconds, millisecondsUntil } from "@/lib/deadline";

export async function AssignmentStudyContent({ params, presentation }: {
  params: Promise<{ id: string }>;
  presentation: StudyPresentation;
}) {
  const student = await requireStudentSession();
  const { id } = await params;
  const study = await getAssignmentStudy(student, id);
  if (!study) notFound();
  if ("release" in study) {
    const remaining = millisecondsUntil(study.release.opensAt, currentTimeMilliseconds());
    return <AssignmentStudyFrame presentation={presentation} title={study.title}>
      <p role="status">{assignmentReleaseNotice(study.release)}</p>
      {study.release.state === "waiting_time" && study.release.opensAt && remaining !== null
        ? <AssignmentBoundaryRefresh boundaryAt={study.release.opensAt} initialRemainingMilliseconds={remaining} />
        : null}
    </AssignmentStudyFrame>;
  }
  return <AssignmentStudyReader key={`${study.assignmentId}:${study.mode}`} presentation={presentation} study={study} />;
}
