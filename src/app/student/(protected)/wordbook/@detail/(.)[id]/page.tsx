import { NotebookDetailContent } from "@/features/student-dashboard/server/components/notebook-content";
export default function Page({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> }) { return <NotebookDetailContent params={params} searchParams={searchParams} presentation="intercepted" />; }

