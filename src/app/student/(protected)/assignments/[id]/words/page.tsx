import { AssignmentStudyContent } from "@/features/student-dashboard/server/components/assignment-study-content";

export const metadata = { title: "내 단어장" };

export default function StudentAssignmentStudyPage({ params }: { params: Promise<{ id: string }> }) {
  return <AssignmentStudyContent params={params} presentation="page" />;
}
