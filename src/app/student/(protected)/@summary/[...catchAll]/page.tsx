import { StudentHeaderPoints } from "@/features/learning-points/server/components/student-header-points";

export default async function StudentSummaryPage({
  params,
}: {
  params: Promise<{ catchAll: string[] }>;
}) {
  const { catchAll } = await params;
  return <StudentHeaderPoints segments={catchAll} />;
}
