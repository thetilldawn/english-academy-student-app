import { Suspense } from "react";
import { SchoolScheduleEditorContent } from "@/features/school-schedules/public-server";
export default function SchoolScheduleEditDialog({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  return <Suspense fallback={<p role="status">학교 일정을 불러오고 있습니다.</p>}><SchoolScheduleEditorContent searchParams={searchParams} presentation="dialog" /></Suspense>;
}
