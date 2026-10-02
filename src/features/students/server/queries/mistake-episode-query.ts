import "server-only";
import { z } from "zod";
import { requireAdmin, type AdminContext } from "@/lib/auth/admin";
import { getStudentSession, type StudentSession } from "@/lib/auth/student-session";
import { getServiceSupabaseClient } from "@/lib/supabase/service";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import {
  adminMistakePageSchema, adminMistakeWordSchema, mistakeCursorSchema, mistakeFiltersSchema,
  mistakePageSchema, mistakeStudyPageSchema, mistakeWordSchema, mistakeMeaningSchema, adminMistakeMeaningSchema, type MistakeFilters,
} from "../../contracts/mistake-episode";
import { mistakeEpisodeCursorSchema } from "../../contracts/mistake-episode-history";
import { hydrateStudyRows, notebookStudySourceSchema } from "./notebook-study-query";
import { decodeNotebookWordToken } from "../notebook-cursor";

export class MistakeReadError extends Error {
  constructor(public readonly reason: "unauthenticated" | "forbidden" | "changed" | "invalid" | "unavailable" = "unavailable") {
    super(reason === "changed" ? "오답 목록이 바뀌었습니다. 최신 목록에서 다시 선택해 주세요."
      : reason === "unauthenticated" || reason === "forbidden" ? "다시 로그인해 주세요."
      : reason === "invalid" ? "조회 조건을 확인해 주세요."
      : "오답 목록을 불러오지 못했습니다. 다시 시도해 주세요.");
  }
}
type Input = { filters: MistakeFilters; cursor?: string | null; wordKey?: string; upperVersion?: string };
const rawFields = { cursor: mistakeCursorSchema, studySource: notebookStudySourceSchema };
const rawEpisodeCursor = mistakeEpisodeCursorSchema.nullable().transform(value => value ? Buffer.from(JSON.stringify(value)).toString("base64url") : null);
const studentRawSchema = mistakePageSchema.omit({ nextCursor: true, items: true }).extend({
  items: z.array(mistakeWordSchema.extend({ ...rawFields, meanings: z.array(mistakeMeaningSchema.extend({ episodeNextCursor: rawEpisodeCursor })).min(1) })).max(11),
});
const adminRawSchema = adminMistakePageSchema.omit({ nextCursor: true, items: true }).extend({
  items: z.array(adminMistakeWordSchema.extend({ ...rawFields, meanings: z.array(adminMistakeMeaningSchema.extend({ episodeNextCursor: rawEpisodeCursor })).min(1) })).max(11),
});

export function decodeMistakeCursor(value: string, studentId: string) {
  try {
    if (!/^[A-Za-z0-9_-]{1,8000}$/.test(value)) throw new Error();
    const text = Buffer.from(value, "base64url").toString("utf8");
    if (Buffer.from(text).toString("base64url") !== value) throw new Error();
    const cursor = mistakeCursorSchema.parse(JSON.parse(text));
    if (cursor.studentId !== studentId) throw new MistakeReadError("changed");
    return cursor;
  } catch (error) { if (error instanceof MistakeReadError) throw error; throw new MistakeReadError("invalid"); }
}
function parameters(studentId: string, input: Input) {
  const filters = mistakeFiltersSchema.safeParse(input.filters);
  if (!filters.success || (input.wordKey !== undefined && (!input.wordKey || input.wordKey.length > 1000))) throw new MistakeReadError("invalid");
  if (input.upperVersion !== undefined && (filters.data.view !== "history" || !mistakeCursorSchema.shape.stateVersion.safeParse(input.upperVersion).success)) throw new MistakeReadError("invalid");
  return { p_student_id: studentId, p_filters: { ...filters.data, pageSize: 11, ...(input.wordKey ? { key: input.wordKey } : {}), ...(input.upperVersion !== undefined ? { upperVersion: input.upperVersion } : {}) },
    p_cursor: input.cursor ? decodeMistakeCursor(input.cursor, studentId) : null };
}
export function readError(error: { code?: string; message?: string } | null) {
  if (!error) return;
  if (error.code === "42501") throw new MistakeReadError("forbidden");
  if (["40001", "PT409"].includes(error.code ?? "") && error.message?.includes("wrong_history_changed")) throw new MistakeReadError("changed");
  if (error.code === "22023" || error.code === "22P02" || error.code === "22007" || error.code === "22003") throw new MistakeReadError("invalid");
  throw new MistakeReadError();
}
function pageResult<T extends { stateVersion: string; sourceVersion: string; items: { key: string; sourceVersion: string; meanings: { meaningKey: string; stateVersion: string; episodeNextCursor: string | null }[]; cursor: z.infer<typeof mistakeCursorSchema> }[]; totalCount: number | null; summary: unknown; datasetOptions: unknown }>(raw: T, hasCursor: boolean, studentId: string) {
  if (!hasCursor && (raw.totalCount === null || raw.summary === null || raw.datasetOptions === null)) throw new MistakeReadError();
  if (raw.items.some(item => item.cursor.studentId !== studentId || item.sourceVersion !== raw.sourceVersion || item.cursor.sourceVersion !== raw.sourceVersion
    || item.cursor.stateVersion !== raw.stateVersion || item.cursor.key !== item.key
    || item.meanings.some(meaning => meaning.stateVersion !== raw.stateVersion))) throw new MistakeReadError();
  for (const word of raw.items) for (const meaning of word.meanings) if (meaning.episodeNextCursor) {
    const cursor = mistakeEpisodeCursorSchema.parse(JSON.parse(Buffer.from(meaning.episodeNextCursor, "base64url").toString("utf8")));
    if (cursor.studentId !== studentId || cursor.meaningKey !== meaning.meaningKey || cursor.stateVersion !== raw.stateVersion) throw new MistakeReadError();
  }
  const items = raw.items.slice(0, 10), last = items.at(-1);
  // Keep the database's filter fingerprint intact; it is not a JavaScript hash.
  return { ...raw, items, nextCursor: raw.items.length > 10 && last ? Buffer.from(JSON.stringify(last.cursor)).toString("base64url") : null };
}
async function readOwn(input: Input, authenticatedStudent?: StudentSession) {
  const student = authenticatedStudent ?? await getStudentSession();
  if (!student) throw new MistakeReadError("unauthenticated");
  const { data, error } = await getServiceSupabaseClient().rpc("get_student_vocabulary_mistake_page_v1", parameters(student.studentId, input));
  readError(error);
  if (data === null) return null;
  const parsed = studentRawSchema.safeParse(data);
  if (!parsed.success) throw new MistakeReadError();
  return pageResult(parsed.data, !!input.cursor, student.studentId);
}
export async function getOwnMistakePage(input: Input, student?: StudentSession) {
  const page = await readOwn(input, student);
  return page && mistakePageSchema.parse(page);
}
export async function getMistakeStudyPage(input: Input, student?: StudentSession) {
  const page = await readOwn(input, student);
  return page && mistakeStudyPageSchema.parse({ ...page, items: await hydrateStudyRows(page.items) });
}
export async function getMistakeStudyWord(token: string, view: MistakeFilters["view"], upperVersion?: string, student?: StudentSession) {
  const wordKey = decodeNotebookWordToken(token);
  if (!wordKey) return null;
  const page = await getMistakeStudyPage({ wordKey, filters: mistakeFiltersSchema.parse({ view }), upperVersion }, student);
  return page?.items.find(word => word.key === wordKey) ?? null;
}
export async function getAdminMistakePage(studentId: string, input: Input, authenticatedAdmin?: AdminContext) {
  if (!authenticatedAdmin) await requireAdmin();
  const { data, error } = await (await createServerSupabaseClient()).rpc("get_admin_vocabulary_mistake_page_v1", parameters(studentId, input));
  readError(error);
  if (data === null) return null;
  const parsed = adminRawSchema.safeParse(data);
  if (!parsed.success) throw new MistakeReadError();
  if (!input.cursor && parsed.data.reviewDrafts === null) throw new MistakeReadError();
  return adminMistakePageSchema.parse(pageResult(parsed.data, !!input.cursor, studentId));
}
