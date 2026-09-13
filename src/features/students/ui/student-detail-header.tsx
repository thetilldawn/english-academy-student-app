import { DetailHeader } from "@/design-system/patterns/detail-header/detail-header";
import { SchoolExamIdentity } from "@/features/school-schedules/public-ui";

import type { StudentDetailProfile } from "../contracts/student-detail-read-model";

export function StudentDetailHeader({
  headingLevel = 2,
  student,
  titleId,
}: {
  headingLevel?: 1 | 2;
  student: StudentDetailProfile;
  titleId: string;
}) {
  const subtitle = [student.schoolName, student.gradeLabel]
    .filter(Boolean)
    .join(" · ");

  return (
    <SchoolExamIdentity summary={student.schoolSchedule}>
    <DetailHeader
      headingLevel={headingLevel}
      subtitle={subtitle || undefined}
      title={student.displayName}
      titleId={titleId}
    />
    </SchoolExamIdentity>
  );
}
