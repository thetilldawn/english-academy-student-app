import { adminHistoryText } from "@/content/ko/admin-history";
import type { AdminHistoryFailureKind } from "../contracts/admin-history-request-error";

export function historyReadFailureMessage(kind: AdminHistoryFailureKind) {
  return adminHistoryText.read.failure[kind];
}
