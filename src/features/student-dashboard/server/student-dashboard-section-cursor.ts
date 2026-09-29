import "server-only";
import { z } from "zod";
import { StudentDashboardCursorError, assertStudentDashboardCursorOwner } from "./student-dashboard-cursor";

export const studentDashboardSortTimeSchema = z.union([z.iso.datetime({ offset: true }), z.literal("infinity"), z.literal("-infinity")]);
export const studentDashboardCurrentSectionSchema = z.enum(["open","scheduled","needs_attention","deadline_closed"]);
const schema = z.object({
  version: z.literal(3),
  section: studentDashboardCurrentSectionSchema,
  assignmentId: z.uuid(),
  effectiveAt: z.iso.datetime({ offset: true }),
  sortBucket: z.number().int().min(0).max(2),
  sortAt: studentDashboardSortTimeSchema,
  secondarySortAt: studentDashboardSortTimeSchema,
  snapshotAt: z.iso.datetime({ offset: true }),
  studentFingerprint: z.string().regex(/^[a-f0-9]{24}$/u),
}).strict();
export type StudentDashboardSectionCursor = z.infer<typeof schema>;
export function encodeStudentDashboardSectionCursor(payload: StudentDashboardSectionCursor) {
  return Buffer.from(JSON.stringify(schema.parse(payload)), "utf8").toString("base64url");
}
export function decodeStudentDashboardSectionCursor(value: string, studentId: string) {
  try {
    const cursor = schema.parse(JSON.parse(Buffer.from(value,"base64url").toString("utf8")));
    if (Date.parse(cursor.snapshotAt) > Date.now()+300_000 || Date.parse(cursor.effectiveAt) > Date.parse(cursor.snapshotAt)) throw new StudentDashboardCursorError();
    // sortAt may be a future release time. Only activity/snapshot time is bounded.
    assertStudentDashboardCursorOwner({ ...cursor, version: 1 }, studentId);
    return cursor;
  } catch (error) {
    if (error instanceof StudentDashboardCursorError) throw error;
    throw new StudentDashboardCursorError("시험 목록 페이지 기준이 올바르지 않습니다.");
  }
}
