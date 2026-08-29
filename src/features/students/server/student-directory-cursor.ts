import "server-only";

import { createHash } from "node:crypto";
import { z } from "zod";

import type { StudentDirectoryFilters } from "../contracts/student-directory-read-model";

const cursorPayloadSchema = z.object({
  filterFingerprint: z.string().regex(/^[a-f0-9]{24}$/u),
  snapshotAt: z.iso.datetime({ offset: true }),
  sortAt: z.iso.datetime({ offset: true }),
  studentId: z.uuid(),
  version: z.literal(1),
});

export type StudentDirectoryCursorPayload = z.infer<
  typeof cursorPayloadSchema
>;

export class StudentDirectoryCursorError extends Error {
  constructor(message = "학생 목록 페이지 기준이 올바르지 않습니다.") {
    super(message);
    this.name = "StudentDirectoryCursorError";
  }
}
export function studentDirectoryFilterFingerprint(
  filters: StudentDirectoryFilters,
) {
  return createHash("sha256")
    .update(JSON.stringify(filters))
    .digest("hex")
    .slice(0, 24);
}

export function encodeStudentDirectoryCursor(
  payload: StudentDirectoryCursorPayload,
) {
  return Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
}

export function decodeStudentDirectoryCursor(cursor: string) {
  try {
    const decoded: unknown = JSON.parse(
      Buffer.from(cursor, "base64url").toString("utf8"),
    );
    const parsed = cursorPayloadSchema.safeParse(decoded);
    if (!parsed.success) throw new StudentDirectoryCursorError();
    const snapshotAt = Date.parse(parsed.data.snapshotAt);
    if (
      Date.parse(parsed.data.sortAt) > snapshotAt ||
      snapshotAt > Date.now() + 5 * 60_000
    ) {
      throw new StudentDirectoryCursorError();
    }
    return parsed.data;
  } catch (error) {
    if (error instanceof StudentDirectoryCursorError) throw error;
    throw new StudentDirectoryCursorError();
  }
}

export function assertStudentDirectoryCursorFilters(
  cursor: StudentDirectoryCursorPayload,
  filters: StudentDirectoryFilters,
) {
  if (
    cursor.filterFingerprint !==
    studentDirectoryFilterFingerprint(filters)
  ) {
    throw new StudentDirectoryCursorError(
      "검색 조건이 바뀌었습니다. 첫 목록부터 다시 확인해 주세요.",
    );
  }
}
