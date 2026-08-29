import "server-only";

import { createHash } from "node:crypto";
import { z } from "zod";

const cursorPayloadSchema = z.object({
  assignmentId: z.uuid(),
  effectiveAt: z.iso.datetime({ offset: true }),
  snapshotAt: z.iso.datetime({ offset: true }),
  studentFingerprint: z.string().regex(/^[a-f0-9]{24}$/u),
  version: z.literal(1),
});

export type StudentDashboardCursorPayload = z.infer<
  typeof cursorPayloadSchema
>;

export class StudentDashboardCursorError extends Error {
  constructor(message = "완료 내역 페이지 기준이 올바르지 않습니다.") {
    super(message);
    this.name = "StudentDashboardCursorError";
  }
}

export function studentDashboardStudentFingerprint(studentId: string) {
  return createHash("sha256").update(studentId).digest("hex").slice(0, 24);
}

export function encodeStudentDashboardCursor(
  payload: StudentDashboardCursorPayload,
) {
  return Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
}

export function decodeStudentDashboardCursor(cursor: string) {
  try {
    const decoded: unknown = JSON.parse(
      Buffer.from(cursor, "base64url").toString("utf8"),
    );
    const parsed = cursorPayloadSchema.safeParse(decoded);
    if (!parsed.success) throw new StudentDashboardCursorError();
    const snapshotMilliseconds = Date.parse(parsed.data.snapshotAt);
    if (
      Date.parse(parsed.data.effectiveAt) > snapshotMilliseconds ||
      snapshotMilliseconds > Date.now() + 5 * 60_000
    ) {
      throw new StudentDashboardCursorError();
    }
    return parsed.data;
  } catch (error) {
    if (error instanceof StudentDashboardCursorError) throw error;
    throw new StudentDashboardCursorError();
  }
}

export function assertStudentDashboardCursorOwner(
  cursor: StudentDashboardCursorPayload,
  studentId: string,
) {
  if (
    cursor.studentFingerprint !==
    studentDashboardStudentFingerprint(studentId)
  ) {
    throw new StudentDashboardCursorError(
      "학생 정보가 바뀌었습니다. 첫 화면부터 다시 확인해 주세요.",
    );
  }
}
