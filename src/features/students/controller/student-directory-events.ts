const STUDENT_REMOVED_EVENT = "admin-student-directory:student-removed";
const STUDENT_REFRESH_EVENT = "admin-student-directory:refresh-requested";

export function announceStudentRemoved(studentId: string) {
  window.dispatchEvent(new CustomEvent(STUDENT_REMOVED_EVENT, {
    detail: { studentId },
  }));
}

export function announceStudentDirectoryRefresh() {
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
