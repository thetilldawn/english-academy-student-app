import type { AdminHistoryMutationNotice } from "../contracts/admin-history-mutation";
import { announceAdminPrivateCacheChange } from "@/features/session/public-client";
import { ADMIN_HISTORY_CHANGED_EVENT } from "./history-change-listener";

export function announceAdminHistoryMutation(notice: AdminHistoryMutationNotice) {
  // Record the local DB minimum before the private invalidation signal.
  window.dispatchEvent(new CustomEvent(ADMIN_HISTORY_CHANGED_EVENT, { detail: notice }));
  announceAdminPrivateCacheChange("students");
}
