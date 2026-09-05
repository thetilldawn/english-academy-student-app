"use client";
import { AssignmentStudyError } from "@/features/student-dashboard/ui/assignment-study-error";
export default function Error({ unstable_retry }: { unstable_retry: () => void }) {
  // Next 16.2: reset alone re-renders the failed payload; retry re-fetches it.
  return <AssignmentStudyError presentation="page" retry={unstable_retry} />;
}
