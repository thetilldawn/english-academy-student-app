import type { Metadata } from "next";
import { Suspense } from "react";

import { adminStudentsText } from "@/content/ko/admin-students";
import { StudentCreateContent } from "@/features/students/server/components/student-create-content";
import { StudentDirectoryContent } from "@/features/students/server/components/student-directory-content";
import { StudentDirectorySkeleton } from "@/features/students/ui/student-directory-skeleton";
import { RouteLoadingState } from "@/design-system/patterns/route-state/route-state";

export const metadata: Metadata = {
  title: adminStudentsText.page.title,
};

export default function StudentsPage() {
  return (
    <>
      <Suspense
        fallback={(
          <RouteLoadingState
            label={adminStudentsText.createStudent.open}
            variant="compact"
          />
        )}
      >
        <StudentCreateContent />
      </Suspense>
      <Suspense fallback={<StudentDirectorySkeleton />}>
        <StudentDirectoryContent />
      </Suspense>
    </>
  );
}
