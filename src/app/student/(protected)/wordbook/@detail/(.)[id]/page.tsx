import { NotebookDetailContent } from "@/features/student-dashboard/server/components/notebook-content";
export default function Page({ params }: { params: Promise<{ id: string }> }) { return <NotebookDetailContent params={params} presentation="intercepted" />; }

