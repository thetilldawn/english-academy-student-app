import { notFound } from "next/navigation";
import { headers } from "next/headers";
import { requireStudentSession } from "@/lib/auth/student-session";
import { studentNotebookCacheIdentity } from "@/lib/auth/private-cache-identity";
import { getMistakeStudyPage, getMistakeStudyWord } from "@/features/students/public-server";
import { mistakeFiltersSchema } from "@/features/students/public-contracts";
import { NotebookReader } from "../../client/components/notebook-reader";
import { NotebookDetail } from "../../client/components/notebook-detail";
type Search = Promise<Record<string, string | string[] | undefined>>;
async function readView(searchParams?: Search) {
  const search = await searchParams ?? {};
  if (search.view !== undefined && search.view !== "current" && search.view !== "history") notFound();
  if (search.upperVersion !== undefined && (typeof search.upperVersion !== "string" || !/^\d{1,19}$/.test(search.upperVersion) || BigInt(search.upperVersion) > BigInt("9223372036854775807"))) notFound();
  return { view: search.view ?? "current" as "current" | "history", upperVersion: search.upperVersion as string | undefined };
}
export async function NotebookContent({ searchParams }: { searchParams?: Search } = {}) {
  const student = await requireStudentSession();
  const { view } = await readView(searchParams), filters = mistakeFiltersSchema.parse({ view });
  const requestHeaders = await headers();
  const destination = requestHeaders.get("sec-fetch-dest");
  // Headers choose rendering strategy only; the authenticated session above
  // is required for both document and internal navigation.
  const documentRequest = destination === "document" || (!destination && requestHeaders.get("accept")?.includes("text/html"));
  const page = documentRequest ? await getMistakeStudyPage({ filters }, student) : undefined;
  if (documentRequest && !page) notFound();
  return <NotebookReader initial={page ?? undefined} initialFilters={filters} initialIdentity={studentNotebookCacheIdentity(student)} />;
}
export async function NotebookDetailContent({ params, searchParams, presentation }: { params: Promise<{ id: string }>; searchParams?: Search; presentation: "page" | "intercepted" }) {
  const student = await requireStudentSession();
  const { id } = await params;
  const { view, upperVersion } = await readView(searchParams);
  const word = await getMistakeStudyWord(id, view, view === "history" ? upperVersion : undefined, student);
  if (!word) notFound();
  return <NotebookDetail word={word} view={view} presentation={presentation} initialIdentity={studentNotebookCacheIdentity(student)} />;
}

