import "server-only";
import { createHash } from "node:crypto";
import type { AdminContext } from "./admin";
import type { StudentSession } from "./student-session";

/** Scope marker from validated claims, never authorization or a session token. */
export function privateListCacheIdentity(admin: AdminContext, scope: "student-directory-v1" | "history-list-v1") {
  return admin.sessionId ? createHash("sha256").update(`${scope}:${admin.userId}:${admin.sessionId}`).digest("hex") : null;
}
export function studentNotebookCacheIdentity(student: Pick<StudentSession, "studentId" | "sessionId">): string {
  return createHash("sha256").update(`student-notebook-v1:${student.studentId}:${student.sessionId}`).digest("hex");
}
