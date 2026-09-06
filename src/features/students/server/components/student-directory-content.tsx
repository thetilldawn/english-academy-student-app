import { unstable_rethrow } from "next/navigation";
import { getStudentDirectoryCacheSeed } from "../queries/student-directory-entry-query";

import { adminStudentsText } from "@/content/ko/admin-students";
import { PanelLoadFailure } from "@/design-system/patterns/route-state/route-state";
import { getAdminListCachePolicy } from "@/lib/env";

import { emptyStudentDirectoryFilters } from "../../contracts/student-directory-read-model";
import { StudentDirectory } from "../../ui/student-directory";
import { CachedStudentDirectory } from "../../ui/cached-student-directory";
import { getStudentDirectoryInitial } from "../queries/student-directory-query";

export async function StudentDirectoryContent() {
  const cacheEnabled = getAdminListCachePolicy().students;
  let initialSnapshot;
  let initialResponse;
  try {
    if (cacheEnabled) initialResponse = await getStudentDirectoryCacheSeed(emptyStudentDirectoryFilters);
    else initialSnapshot = await getStudentDirectoryInitial(
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
  if (cacheEnabled) return <CachedStudentDirectory initialResponse={initialResponse} />;
  return <StudentDirectory initialSnapshot={initialSnapshot!} />;
}
