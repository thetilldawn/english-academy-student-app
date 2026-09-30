import { NotebookDetailContent } from "@/features/student-dashboard/server/components/notebook-content";
export const metadata = { title: "단어 상세" };
export default function Page({ params }: { params: Promise<{ id: string }> }) { return <NotebookDetailContent params={params} presentation="page" />; }

