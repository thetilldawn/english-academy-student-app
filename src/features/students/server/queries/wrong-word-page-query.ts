import "server-only";
import { z } from "zod";
import { requireAdmin, type AdminContext } from "@/lib/auth/admin";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { wrongWordFiltersSchema, wrongWordItemSchema, wrongWordPageSchema, type WrongWordPage, type WrongWordPageFilters } from "../../contracts/wrong-word-page";
import { decodeWrongWordCursor, encodeWrongWordCursor } from "../wrong-word-cursor";

const responseSchema = wrongWordPageSchema.omit({ nextCursor: true, items: true }).extend({
  items: z.array(wrongWordItemSchema).max(11), eventUpperId: z.string().regex(/^\d{1,19}$/),
});
export class WrongWordPageForbiddenError extends Error {}

export async function getStudentWrongWordPage(
  studentId: string,
  input: { filters: WrongWordPageFilters; cursor?: string | null },
  authenticatedAdmin?: AdminContext,
): Promise<WrongWordPage | null> {
  if (!authenticatedAdmin) await requireAdmin();
  const filters = wrongWordFiltersSchema.parse(input.filters);
  const cursor = input.cursor ? decodeWrongWordCursor(input.cursor, studentId, filters) : null;
  const supabase = await createServerSupabaseClient();
  const { data, error } = await supabase.rpc("get_admin_student_wrong_word_page_v1", {
    p_student_id: studentId, p_dataset_id: filters.datasetId || null, p_level: filters.level, p_query: filters.query,
    p_event_upper_id: cursor?.eventUpperId ?? null, p_after_wrong_at: cursor?.lastWrongAt ?? null, p_after_key: cursor?.key ?? null,
  });
  if (error?.code === "42501") throw new WrongWordPageForbiddenError("관리자 권한을 다시 확인해 주세요.");
  if (error) throw new Error("오답 단어 이력을 불러오지 못했습니다.");
  if (data === null) return null;
  const result = responseSchema.parse(data);
  if (!cursor && (result.summary === null || result.datasetOptions === null || result.reviewDrafts === null || result.totalCount === null)) {
    throw new Error("오답 단어 요약을 확인하지 못했습니다.");
  }
  const items = result.items.slice(0, 10);
  const last = items.at(-1);
  return {
    items, summary: result.summary, totalCount: result.totalCount,
    datasetOptions: result.datasetOptions, reviewDrafts: result.reviewDrafts,
    nextCursor: result.items.length > 10 && last ? encodeWrongWordCursor({
      studentId, filters, eventUpperId: result.eventUpperId, lastWrongAt: last.lastWrongAt, key: last.key,
    }) : null,
  };
}
