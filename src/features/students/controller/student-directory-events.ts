import { announceAdminPrivateCacheChange } from "@/features/session/public-client";

const STUDENT_REMOVED_EVENT = "admin-student-directory:student-removed";
const STUDENT_REFRESH_EVENT = "admin-student-directory:refresh-requested";
const STUDENT_PROFILE_EVENT = "admin-student-directory:profile-updated";
type StudentProfileChange = { id: string; displayName: string; schoolName: string | null; gradeLabel: string | null };

/** A validated save receipt updates an open assignment without reloading its draft. */
export function announceStudentProfileUpdated(profile: StudentProfileChange) {
  window.dispatchEvent(new CustomEvent(STUDENT_PROFILE_EVENT, { detail: {
    id: profile.id, displayName: profile.displayName, schoolName: profile.schoolName, gradeLabel: profile.gradeLabel,
  } }));
}

export function subscribeStudentProfileUpdated(listener: (profile: StudentProfileChange) => void) {
  const receive = (event: Event) => listener((event as CustomEvent<StudentProfileChange>).detail);
  window.addEventListener(STUDENT_PROFILE_EVENT, receive);
  return () => window.removeEventListener(STUDENT_PROFILE_EVENT, receive);
}

export function announceStudentRemoved(studentId: string) {
  announceAdminPrivateCacheChange("students");
  window.dispatchEvent(new CustomEvent(STUDENT_REMOVED_EVENT, {
    detail: { studentId },
  }));
}

export function announceStudentDirectoryRefresh(options: { broadcast?: boolean } = {}) {
  if (options.broadcast !== false) announceAdminPrivateCacheChange("students");
  window.dispatchEvent(new Event(STUDENT_REFRESH_EVENT));
}

export function subscribeStudentRemoved(
  listener: (studentId: string) => void,
) {
  const handleRemoved = (event: Event) => {
    const studentId = (event as CustomEvent<{ studentId?: unknown }>).detail
      ?.studentId;
    if (typeof studentId === "string") listener(studentId);
  };
  window.addEventListener(STUDENT_REMOVED_EVENT, handleRemoved);
  return () => window.removeEventListener(STUDENT_REMOVED_EVENT, handleRemoved);
}

export function subscribeStudentDirectoryRefresh(listener: () => void) {
  window.addEventListener(STUDENT_REFRESH_EVENT, listener);
  return () => window.removeEventListener(STUDENT_REFRESH_EVENT, listener);
}
