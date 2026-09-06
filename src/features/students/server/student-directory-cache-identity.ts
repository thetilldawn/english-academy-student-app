import "server-only";
import { privateListCacheIdentity } from "@/lib/auth/private-cache-identity";
import type { AdminContext } from "@/lib/auth/admin";

/** A scope marker, never proof of authorization. Derive only from validated claims. */
export function studentDirectoryCacheIdentity(admin: AdminContext) {
  return privateListCacheIdentity(admin, "student-directory-v1");
}
