import type { AdminHistoryListItem } from "./admin-history-read-model";

export type AdminHistoryMutationReceipt = {
  assignmentId: string;
  attemptId: string | null;
  kind: "cancelled" | "hidden";
  studentId: string;
  version: string;
};

export type AdminHistoryCancellationResponse = {
  item: AdminHistoryListItem;
  receipt: AdminHistoryMutationReceipt;
  status: "cancelled";
};

export type AdminHistoryHideActionResult =
  | {
      ok: true;
      receipt: AdminHistoryMutationReceipt;
    }
  | {
      error: string;
      ok: false;
      status: 400 | 401 | 403 | 404 | 409 | 503;
    };

export type AdminHistoryMutationNotice = {
  after: AdminHistoryListItem | null;
  before: AdminHistoryListItem;
  receipt: AdminHistoryMutationReceipt;
};

