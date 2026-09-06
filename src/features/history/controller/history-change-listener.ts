import type { AdminHistoryMutationNotice } from "../contracts/admin-history-mutation";

export const ADMIN_HISTORY_CHANGED_EVENT = "admin-history:mutated";

/** Read-only subscription. Publishing mutations is owned by the command side. */
export function subscribeAdminHistoryMutation(listener: (notice: AdminHistoryMutationNotice) => void) {
  const handleChange = (event: Event) => {
    const notice = (event as CustomEvent<AdminHistoryMutationNotice>).detail;
    if (notice?.receipt?.assignmentId) listener(notice);
  };
  window.addEventListener(ADMIN_HISTORY_CHANGED_EVENT, handleChange);
  return () => window.removeEventListener(ADMIN_HISTORY_CHANGED_EVENT, handleChange);
}
