import "server-only";
import { headers } from "next/headers";
import { requireAdmin } from "@/lib/auth/admin";
import { privateListCacheIdentity } from "@/lib/auth/private-cache-identity";
import type { HistoryCacheSeed } from "../../contracts/history-list-cache-contract";
import { listAdminHistoryInitial } from "./admin-history-list-query";

/** Document strategy only; headers never grant access. */
export async function getHistoryListCacheSeed(): Promise<HistoryCacheSeed | undefined> {
  const requestHeaders = await headers();
  const destination = requestHeaders.get("sec-fetch-dest");
  if (!(destination === "document" || (!destination && requestHeaders.get("accept")?.includes("text/html")))) return undefined;
  const admin = await requireAdmin();
  const snapshot = await listAdminHistoryInitial({ currentOnly: false }, admin);
  return { kind: "snapshot", identity: privateListCacheIdentity(admin, "history-list-v1"), userId: admin.userId, snapshot };
}
