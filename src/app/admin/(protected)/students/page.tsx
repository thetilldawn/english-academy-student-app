import type { Metadata } from "next";
import { Suspense } from "react";

import { adminStudentsText } from "@/content/ko/admin-students";
import { StudentCreateContent } from "@/features/students/server/components/student-create-content";
import { StudentDirectoryContent } from "@/features/students/server/components/student-directory-content";
import { StudentDirectorySkeleton } from "@/features/students/ui/student-directory-skeleton";
import { StudentCreatePending } from "@/features/students/ui/student-create-workspace";

export const metadata: Metadata = {
  title: adminStudentsText.page.title,
};

export default function StudentsPage() {
  return (
    <>
      <Suspense fallback={<StudentCreatePending />}>
        <StudentCreateContent />
      </Suspense>
      <Suspense fallback={<StudentDirectorySkeleton />}>
        <StudentDirectoryContent />
      </Suspense>
    </>
  );
}
