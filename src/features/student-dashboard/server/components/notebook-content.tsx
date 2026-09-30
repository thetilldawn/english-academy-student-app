import { notFound } from "next/navigation";
import { requireStudentSession } from "@/lib/auth/student-session";
import { getNotebookPage, getNotebookWord } from "@/features/students/public-server";
import { notebookFiltersSchema } from "@/features/students/public-contracts";
import { NotebookReader } from "../../client/components/notebook-reader";
import { NotebookDetail } from "../../client/components/notebook-detail";
export async function NotebookContent() {
  const student = await requireStudentSession();
  const page = await getNotebookPage({ filters: notebookFiltersSchema.parse({}) }, student);
  if (!page) notFound();
  return <NotebookReader initial={page} />;
}
export async function NotebookDetailContent({ params, presentation }: { params: Promise<{ id: string }>; presentation: "page" | "intercepted" }) {
  const student = await requireStudentSession();
  const { id } = await params;
  const word = await getNotebookWord(id, student);
  if (!word) notFound();
  return <NotebookDetail word={word} presentation={presentation} />;
}

