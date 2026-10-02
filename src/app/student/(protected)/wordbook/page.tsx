import { NotebookContent } from "@/features/student-dashboard/server/components/notebook-content";
export const metadata = { title: "내 단어장" };
export default function Page({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) { return <NotebookContent searchParams={searchParams} />; }

