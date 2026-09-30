import "server-only";
import { z } from "zod";
import { getStudentSession, type StudentSession } from "@/lib/auth/student-session";
import { getServiceSupabaseClient } from "@/lib/supabase/service";
import { wrongWordFiltersSchema, type WrongWordPageFilters } from "../../contracts/wrong-word-filters";
import { wrongWordNotebookItemSchema, wrongWordNotebookPageSchema, type WrongWordNotebookPage } from "../../contracts/wrong-word-notebook";
import { decodeWrongWordCursor, encodeWrongWordCursor } from "../wrong-word-cursor";

const responseSchema = wrongWordNotebookPageSchema.omit({ nextCursor: true, items: true }).extend({
  items: z.array(wrongWordNotebookItemSchema).max(11),
  eventUpperId: z.string().regex(/^\d{1,19}$/),
});
export class OwnWrongWordReadError extends Error {
  constructor(public readonly reason: "unauthenticated" | "unavailable" = "unavailable") {
    super(reason === "unauthenticated" ? "학생 인증이 필요합니다." : "오답 단어를 불러오지 못했습니다. 다시 시도해 주세요.");
  }
}

/** RSC authenticates here; HTTP may forward its already-validated server session.
 * Never accept a browser-supplied student ID or share this module with client code. */
export async function getOwnWrongWordPage(
  input: { filters: WrongWordPageFilters; cursor?: string | null },
  authenticatedStudent?: StudentSession,
): Promise<WrongWordNotebookPage | null> {
  const student = authenticatedStudent ?? await getStudentSession();
  if (!student) throw new OwnWrongWordReadError("unauthenticated");
  const filters = wrongWordFiltersSchema.parse(input.filters);
  const cursor = input.cursor ? decodeWrongWordCursor(input.cursor, student.studentId, filters) : null;
  const { data, error } = await getServiceSupabaseClient().rpc("get_student_wrong_word_notebook_page_v1", {
    p_student_id: student.studentId, p_dataset_id: filters.datasetId || null, p_level: filters.level, p_query: filters.query,
    p_event_upper_id: cursor?.eventUpperId ?? null, p_after_wrong_at: cursor?.lastWrongAt ?? null, p_after_key: cursor?.key ?? null,
    p_min_wrong_count: filters.minWrongCount ?? null, p_max_wrong_count: filters.maxWrongCount ?? null,
  });
  if (error) throw new OwnWrongWordReadError();
  if (data === null) return null;
  const parsed = responseSchema.safeParse(data);
  if (!parsed.success) throw new OwnWrongWordReadError();
  const result = parsed.data;
  if (!cursor && (result.summary === null || result.datasetOptions === null || result.totalCount === null)) {
    throw new OwnWrongWordReadError();
  }
  const items = result.items.slice(0, 10);
  const last = items.at(-1);
  return {
    items, summary: result.summary, totalCount: result.totalCount, datasetOptions: result.datasetOptions,
    nextCursor: result.items.length > 10 && last ? encodeWrongWordCursor({
      studentId: student.studentId, filters, eventUpperId: result.eventUpperId, lastWrongAt: last.lastWrongAt, key: last.key,
    }) : null,
  };
}

