import "server-only";

import { createHash } from "node:crypto";
import { z } from "zod";

import type { StudentHistoryFilters } from "../contracts/student-detail-read-model";

const cursorSchema = z.object({
  effectiveAt: z.iso.datetime({ offset: true }),
  entryKey: z.string().min(1).max(180),
  filterFingerprint: z.string().regex(/^[a-f0-9]{24}$/u),
  snapshotAt: z.iso.datetime({ offset: true }),
  studentId: z.uuid(),
  version: z.literal(1),
});

export type StudentHistoryCursor = z.infer<typeof cursorSchema>;

export class StudentHistoryCursorError extends Error {
  constructor(message = "학생 내역 페이지 기준이 올바르지 않습니다.") {
    super(message);
    this.name = "StudentHistoryCursorError";
  }
}

export function studentHistoryFilterFingerprint(
  filters: StudentHistoryFilters,
) {
  return createHash("sha256")
    .update(JSON.stringify(filters))
    .digest("hex")
    .slice(0, 24);
}

export function encodeStudentHistoryCursor(cursor: StudentHistoryCursor) {
  return Buffer.from(JSON.stringify(cursor), "utf8").toString("base64url");
}

export function decodeStudentHistoryCursor(cursor: string) {
  try {
    const value: unknown = JSON.parse(
      Buffer.from(cursor, "base64url").toString("utf8"),
    );
    const parsed = cursorSchema.safeParse(value);
    if (!parsed.success) throw new StudentHistoryCursorError();
    if (
      Date.parse(parsed.data.effectiveAt) > Date.parse(parsed.data.snapshotAt) ||
      Date.parse(parsed.data.snapshotAt) > Date.now() + 5 * 60_000
    ) {
      throw new StudentHistoryCursorError();
    }
    return parsed.data;
  } catch (error) {
    if (error instanceof StudentHistoryCursorError) throw error;
    throw new StudentHistoryCursorError();
  }
}

export function assertStudentHistoryCursorScope(
  cursor: StudentHistoryCursor,
  input: { filters: StudentHistoryFilters; studentId: string },
) {
  if (
    cursor.studentId !== input.studentId ||
    cursor.filterFingerprint !== studentHistoryFilterFingerprint(input.filters)
  ) {
    throw new StudentHistoryCursorError(
      "내역 조건이 바뀌었습니다. 첫 목록부터 다시 확인해 주세요.",
    );
  }
}
