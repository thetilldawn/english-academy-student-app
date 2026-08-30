import { unstable_rethrow } from "next/navigation";

import { adminStudentsText } from "@/content/ko/admin-students";
import { PanelLoadFailure } from "@/design-system/patterns/route-state/route-state";

import { emptyStudentDirectoryFilters } from "../../contracts/student-directory-read-model";
import { StudentDirectory } from "../../ui/student-directory";
import { getStudentDirectoryInitial } from "../queries/student-directory-query";

export async function StudentDirectoryContent() {
  let initialSnapshot;
  try {
    initialSnapshot = await getStudentDirectoryInitial(
      { filters: emptyStudentDirectoryFilters },
    );
  } catch (error) {
    unstable_rethrow(error);
    return (
      <PanelLoadFailure
        message={adminStudentsText.page.loadError}
        retryHref="/admin/students"
        retryLabel={adminStudentsText.page.retry}
      />
    );
  }
  return <StudentDirectory initialSnapshot={initialSnapshot} />;
}
