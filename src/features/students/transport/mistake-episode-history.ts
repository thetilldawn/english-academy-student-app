import { mistakeEpisodeHistoryPageSchema, mistakeEpisodeHistoryInputSchema,
  type MistakeEpisodeHistoryInput, type MistakeEpisodeHistoryReader } from "../contracts/mistake-episode-history";

export class MistakeEpisodeHistoryError extends Error {
  constructor(public readonly status: number) {
    super(status === 401 || status === 403 ? "다시 로그인해 주세요."
      : status === 409 || status === 404 ? "이력 목록이 바뀌었습니다. 목록에서 다시 열어 주세요."
      : "오답 이력을 불러오지 못했습니다. 다시 시도해 주세요.");
  }
}
export async function loadMistakeEpisodeHistory(reader: MistakeEpisodeHistoryReader, input: MistakeEpisodeHistoryInput, signal: AbortSignal) {
  const parsedInput = mistakeEpisodeHistoryInputSchema.parse(input);
  const params = new URLSearchParams({ meaningKey: parsedInput.meaningKey, upperVersion: parsedInput.upperVersion });
  if (parsedInput.cursor) params.set("cursor", parsedInput.cursor);
  const url = reader.kind === "student" ? "/api/student/notebook/episodes" : `/api/admin/students/${reader.studentId}/wrong-words/episodes`;
  const response = await fetch(`${url}?${params}`, { cache: "no-store", signal,
    ...(reader.kind === "student" ? { headers: { "x-student-notebook-identity": reader.identity } } : {}) });
  if (!response.ok) throw new MistakeEpisodeHistoryError(response.status);
  let payload: { page?: unknown; identity?: unknown };
  try { payload = await response.json(); } catch { throw new MistakeEpisodeHistoryError(502); }
  if (reader.kind === "student" && payload.identity !== reader.identity) throw new MistakeEpisodeHistoryError(401);
  const parsed = mistakeEpisodeHistoryPageSchema.safeParse(payload.page);
  if (!parsed.success || parsed.data.meaningKey !== input.meaningKey || parsed.data.stateVersion !== input.upperVersion)
    throw new MistakeEpisodeHistoryError(502);
  return parsed.data;
}
