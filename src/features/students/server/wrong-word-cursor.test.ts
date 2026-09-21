import { describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { decodeWrongWordCursor, encodeWrongWordCursor, WrongWordCursorError } from "./wrong-word-cursor";
const input = { studentId: "00000000-0000-4000-8000-000000000001", filters: { datasetId: "", level: "all" as const, query: "" },
  eventUpperId: "9007199254740999", lastWrongAt: "2026-09-21T00:00:00.000001Z", key: "dictionary:word:검사" };
describe("wrong word page cursor", () => {
  it("preserves large event ids and precise timestamp strings", () => {
    expect(decodeWrongWordCursor(encodeWrongWordCursor(input), input.studentId, input.filters)).toMatchObject({eventUpperId:input.eventUpperId,lastWrongAt:input.lastWrongAt,key:input.key});
  });
  it("rejects a different student, changed filter, malformed or overlong cursor", () => {
    const cursor=encodeWrongWordCursor(input);
    expect(()=>decodeWrongWordCursor(cursor,"00000000-0000-4000-8000-000000000002",input.filters)).toThrow(WrongWordCursorError);
    expect(()=>decodeWrongWordCursor(cursor,input.studentId,{...input.filters,query:"new"})).toThrow(WrongWordCursorError);
    expect(()=>decodeWrongWordCursor("not-json",input.studentId,input.filters)).toThrow(WrongWordCursorError);
    expect(()=>decodeWrongWordCursor("x".repeat(8001),input.studentId,input.filters)).toThrow(WrongWordCursorError);
  });
});
