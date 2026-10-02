import "server-only";
import { requireAdmin, type AdminContext } from "@/lib/auth/admin";
import { getStudentSession, type StudentSession } from "@/lib/auth/student-session";
import { getServiceSupabaseClient } from "@/lib/supabase/service";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { mistakeEpisodeCursorSchema, mistakeEpisodeHistoryInputSchema, mistakeEpisodeHistoryPageSchema,
  type MistakeEpisodeHistoryInput } from "../../contracts/mistake-episode-history";
import { MistakeReadError, readError } from "./mistake-episode-query";

const rawPageSchema = mistakeEpisodeHistoryPageSchema.extend({ nextCursor: mistakeEpisodeCursorSchema.nullable() });
function parameters(studentId: string, input: MistakeEpisodeHistoryInput) {
  const parsed = mistakeEpisodeHistoryInputSchema.safeParse(input);
  if (!parsed.success) throw new MistakeReadError("invalid");
  let cursor = null;
  if (parsed.data.cursor) {
    try {
      const text = Buffer.from(parsed.data.cursor, "base64url").toString("utf8");
      if (Buffer.from(text).toString("base64url") !== parsed.data.cursor) throw new Error();
      cursor = mistakeEpisodeCursorSchema.parse(JSON.parse(text));
    } catch { throw new MistakeReadError("invalid"); }
    if (cursor.studentId !== studentId || cursor.meaningKey !== input.meaningKey || cursor.stateVersion !== input.upperVersion) throw new MistakeReadError("changed");
  }
  return { p_student_id: studentId, p_meaning_key: input.meaningKey, p_upper: input.upperVersion, p_cursor: cursor };
}
function result(data: unknown, studentId: string, input: MistakeEpisodeHistoryInput) {
  if (data === null) return null;
  const parsed = rawPageSchema.safeParse(data);
  if (!parsed.success) throw new MistakeReadError();
  const page = parsed.data, cursor = page.nextCursor, last = page.items.at(-1);
  if (page.meaningKey !== input.meaningKey || page.stateVersion !== input.upperVersion || page.episodeCount < page.items.length
    || new Set(page.items.map(item => item.episodeId)).size !== page.items.length
    || cursor && (cursor.studentId !== studentId || cursor.meaningKey !== input.meaningKey || cursor.stateVersion !== input.upperVersion
      || page.items.length !== 20 || cursor.episodeId !== last?.episodeId || cursor.openedAt !== last.openedAt)) throw new MistakeReadError();
  return mistakeEpisodeHistoryPageSchema.parse({ ...page, nextCursor: cursor ? Buffer.from(JSON.stringify(cursor)).toString("base64url") : null });
}
export async function getOwnMistakeEpisodeHistory(input: MistakeEpisodeHistoryInput, session?: StudentSession) {
  const student = session ?? await getStudentSession();
  if (!student) throw new MistakeReadError("unauthenticated");
  const { data, error } = await getServiceSupabaseClient().rpc("get_student_vocabulary_mistake_episodes_v1", parameters(student.studentId, input));
  readError(error);
  return result(data, student.studentId, input);
}
export async function getAdminMistakeEpisodeHistory(studentId: string, input: MistakeEpisodeHistoryInput, admin?: AdminContext) {
  if (!admin) await requireAdmin();
  const { data, error } = await (await createServerSupabaseClient()).rpc("get_admin_vocabulary_mistake_episodes_v1", parameters(studentId, input));
  readError(error);
  return result(data, studentId, input);
}
