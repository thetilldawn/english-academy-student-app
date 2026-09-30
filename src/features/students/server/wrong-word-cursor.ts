import "server-only";
import { createHash } from "node:crypto";
import { z } from "zod";
import type { WrongWordPageFilters } from "../contracts/wrong-word-page";
import { wrongWordFilterKey } from "../contracts/wrong-word-filters";
export { wrongWordFilterKey } from "../contracts/wrong-word-filters";

const schema = z.object({
  version: z.literal(1), studentId: z.uuid(), filters: z.string().regex(/^[a-f0-9]{64}$/),
  eventUpperId: z.string().regex(/^\d{1,19}$/).refine(value => BigInt(value) <= BigInt("9223372036854775807")),
  lastWrongAt: z.iso.datetime({ offset: true }), key: z.string().min(1).max(1000),
}).strict();
export class WrongWordCursorError extends Error {
  constructor(public readonly reason: "identity" | "invalid" = "invalid") {
    super(reason === "identity" ? "학생 정보가 바뀌었습니다. 첫 화면부터 다시 확인해 주세요." : "오답 목록의 조건이 바뀌었습니다. 첫 목록부터 다시 확인해 주세요.");
  }
}
function filterHash(filters: WrongWordPageFilters) {
  return createHash("sha256").update(wrongWordFilterKey(filters)).digest("hex");
}
export function encodeWrongWordCursor(input: {
  studentId: string; filters: WrongWordPageFilters; eventUpperId: string; lastWrongAt: string; key: string;
}) {
  return Buffer.from(JSON.stringify(schema.parse({ ...input, version: 1, filters: filterHash(input.filters) })), "utf8").toString("base64url");
}
export function decodeWrongWordCursor(value: string, studentId: string, filters: WrongWordPageFilters) {
  try {
    if (value.length > 8000) throw new WrongWordCursorError();
    const parsed = schema.parse(JSON.parse(Buffer.from(value, "base64url").toString("utf8")));
    if (parsed.studentId !== studentId) throw new WrongWordCursorError("identity");
    if (parsed.filters !== filterHash(filters)) throw new WrongWordCursorError();
    return parsed;
  } catch (error) {
    if (error instanceof WrongWordCursorError) throw error;
    throw new WrongWordCursorError();
  }
}
