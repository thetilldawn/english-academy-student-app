import "server-only";
import { createHash } from "node:crypto";
import { z } from "zod";
import { notebookFilterKey, type NotebookFilters } from "../contracts/notebook-study";
import { WrongWordCursorError } from "./wrong-word-cursor";
const shape = z.object({ version: z.literal(2), studentId: z.uuid(), filters: z.string().length(64),
  eventUpperId: z.string().regex(/^\d{1,19}$/).refine(v => BigInt(v) <= BigInt("9223372036854775807")),
  wrongCount: z.number().int().positive(), lastWrongAt: z.iso.datetime({ offset: true }), key: z.string().min(1).max(1000),
}).strict();
const hash = (filters: NotebookFilters) => createHash("sha256").update(notebookFilterKey(filters)).digest("hex");
export function encodeNotebookCursor(input: Omit<z.infer<typeof shape>, "version" | "filters"> & { filters: NotebookFilters }) {
  return Buffer.from(JSON.stringify(shape.parse({ ...input, version: 2, filters: hash(input.filters) }))).toString("base64url");
}
export function decodeNotebookCursor(value: string, studentId: string, filters: NotebookFilters) {
  try {
    if (value.length > 8000) throw new WrongWordCursorError();
    const cursor = shape.parse(JSON.parse(Buffer.from(value, "base64url").toString("utf8")));
    if (cursor.studentId !== studentId) throw new WrongWordCursorError("identity");
    if (cursor.filters !== hash(filters)) throw new WrongWordCursorError();
    return cursor;
  } catch (error) { if (error instanceof WrongWordCursorError) throw error; throw new WrongWordCursorError(); }
}
export function decodeNotebookWordToken(token: string) {
  if (!/^[A-Za-z0-9_-]{1,5400}$/.test(token)) return null;
  const key = Buffer.from(token, "base64url").toString("utf8");
  return key.length <= 1000 && Buffer.from(key).toString("base64url") === token ? key : null;
}
