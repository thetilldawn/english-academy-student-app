import type { AdminHistoryMutationNotice } from "../contracts/admin-history-mutation";

const ADMIN_HISTORY_MUTATED_EVENT = "admin-history:mutated";

export function announceAdminHistoryMutation(
  notice: AdminHistoryMutationNotice,
) {
  window.dispatchEvent(new CustomEvent(ADMIN_HISTORY_MUTATED_EVENT, {
    detail: notice,
  }));
}

export function subscribeAdminHistoryMutation(
  listener: (notice: AdminHistoryMutationNotice) => void,
) {
  const handleMutation = (event: Event) => {
    const notice = (event as CustomEvent<AdminHistoryMutationNotice>).detail;
    if (notice?.receipt?.assignmentId) listener(notice);
  };
  window.addEventListener(ADMIN_HISTORY_MUTATED_EVENT, handleMutation);
  return () => window.removeEventListener(ADMIN_HISTORY_MUTATED_EVENT, handleMutation);
}

