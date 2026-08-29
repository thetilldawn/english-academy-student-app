import { StudentDetailSkeleton } from "@/features/students/ui/student-detail-skeleton";

export default function InterceptedAdminStudentDetailLoading() {
  return <StudentDetailSkeleton presentation="dialog" />;
}
