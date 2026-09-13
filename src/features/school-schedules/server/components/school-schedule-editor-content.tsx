import { getSchoolScheduleEditorInitial } from "../queries/school-schedule-editor-query";
import { SchoolScheduleEditor } from "../../client/components/school-schedule-editor";
export async function SchoolScheduleEditorContent({ searchParams, presentation }: {
  searchParams: Promise<Record<string, string | string[] | undefined>>; presentation: "dialog" | "page";
}) {
  const initial = await getSchoolScheduleEditorInitial(await searchParams);
  return <SchoolScheduleEditor initial={initial} presentation={presentation} />;
}
