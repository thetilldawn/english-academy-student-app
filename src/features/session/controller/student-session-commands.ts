import { requestStudentLogin as login, requestStudentLogout as logout } from "../api/session";
import { announceStudentPrivateCacheChange } from "./student-private-cache-events";

export async function requestStudentLogin(...args: Parameters<typeof login>) {
  const result = await login(...args);
  if (result.ok) announceStudentPrivateCacheChange("identity");
  return result;
}
export function requestStudentLogout() {
  announceStudentPrivateCacheChange("identity");
  return logout();
}
