"use server";

import type {
  AdminHistoryMutationReceipt,
} from "../contracts/admin-history-mutation";
import { hideAdminHistoryEntryAction } from "../server/actions/hide-admin-history-entry-action";

export async function hideAdminHistoryEntry(
  input: {
    assignmentId: string;
    studentId: string;
    attemptId: string | null;
  },
  fallbackError: string,
): Promise<AdminHistoryMutationReceipt> {
  const result = await hideAdminHistoryEntryAction(input);
  if (!result.ok) throw new Error(result.error || fallbackError);
  return result.receipt;
}
