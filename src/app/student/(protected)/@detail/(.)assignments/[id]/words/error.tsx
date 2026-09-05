"use client";
import { AssignmentStudyError } from "@/features/student-dashboard/ui/assignment-study-error";
export default function Error({ unstable_retry }: { unstable_retry: () => void }) {
  // Next 16.2: re-fetch this segment while retaining its intercepted route.
  return <AssignmentStudyError presentation="dialog" retry={unstable_retry} />;
}
