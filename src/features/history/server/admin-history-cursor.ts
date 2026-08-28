import "server-only";

import { createHash } from "node:crypto";
import { z } from "zod";

import type {
  AdminHistoryReadScope,
} from "@/features/history/contracts/admin-history-read-model";
import type { AdminHistoryStatusFilter } from "@/features/history/domain/learning-activity";

const cursorPayloadSchema = z.object({
  effectiveAt: z.iso.datetime({ offset: true }),
  entryKey: z.string().min(1).max(160),
  filterFingerprint: z.string().regex(/^[a-f0-9]{24}$/u),
  groupKey: z.string().min(1).max(40),
  scope: z.enum(["all", "current"]),
  snapshotAt: z.iso.datetime({ offset: true }),
  version: z.literal(1),
});

export type AdminHistoryCursorPayload = z.infer<
  typeof cursorPayloadSchema
>;

export class AdminHistoryCursorError extends Error {
  constructor(message = "내역 페이지 기준이 올바르지 않습니다.") {
    super(message);
    this.name = "AdminHistoryCursorError";
  }
}

export function adminHistoryFilterFingerprint(input: {
  groupKey: string;
  query: string;
  scope: AdminHistoryReadScope;
  statusFilter: AdminHistoryStatusFilter;
}) {
  return createHash("sha256")
    .update(JSON.stringify(input))
    .digest("hex")
    .slice(0, 24);
}

export function encodeAdminHistoryCursor(
  payload: AdminHistoryCursorPayload,
) {
  return Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
}

export function decodeAdminHistoryCursor(cursor: string) {
  try {
    const value: unknown = JSON.parse(
      Buffer.from(cursor, "base64url").toString("utf8"),
    );
    const parsed = cursorPayloadSchema.safeParse(value);
    if (!parsed.success) throw new AdminHistoryCursorError();
    return parsed.data;
  } catch (error) {
    if (error instanceof AdminHistoryCursorError) throw error;
    throw new AdminHistoryCursorError();
  }
}

export function assertAdminHistoryCursorScope(
  cursor: AdminHistoryCursorPayload,
  expected: {
    groupKey: string;
    query: string;
    scope: AdminHistoryReadScope;
    statusFilter: AdminHistoryStatusFilter;
  },
) {
  const expectedFingerprint = adminHistoryFilterFingerprint(expected);
  if (
    cursor.groupKey !== expected.groupKey ||
    cursor.scope !== expected.scope ||
    cursor.filterFingerprint !== expectedFingerprint
  ) {
    throw new AdminHistoryCursorError(
      "검색 조건이 바뀌었습니다. 첫 목록부터 다시 확인해 주세요.",
    );
  }
}
