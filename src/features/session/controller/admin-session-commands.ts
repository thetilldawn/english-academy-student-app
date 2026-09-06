import { requestAdminLogin as login, requestAdminLogout as logout } from "../api/session";
import { announceAdminPrivateCacheChange } from "./admin-private-cache-events";

/** Session change owns invalidation; the HTTP transport stays side-effect-free. */
export async function requestAdminLogin(...args: Parameters<typeof login>) {
  const result = await login(...args);
  if (result.ok) announceAdminPrivateCacheChange("identity");
  return result;
}

/** Call only after the shared unsaved-navigation guard accepts leaving. */
export function requestAdminLogout() {
  announceAdminPrivateCacheChange("identity");
  return logout();
}
