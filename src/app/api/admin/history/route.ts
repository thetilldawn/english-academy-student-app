import { z } from "zod";

import { adminHistoryStatusFilters } from "@/features/history/contracts/admin-history-read-model";
import { AdminHistoryCursorError } from "@/features/history/server/admin-history-cursor";
import { AdminHistoryReadError } from "@/features/history/server/queries/admin-history-read-error";
import {
  listAdminHistoryFreshSection,
  listAdminHistoryInitial,
  listAdminHistoryNextPage,
} from "@/features/history/server/queries/admin-history-list-query";
import {
  AdminAuthenticationUnavailableError,
  type AdminContext,
  getAdminContext,
  getAdminContextOrThrow,
} from "@/lib/auth/admin";
import {
  isSameOriginRequest,
  parseJson,
  privateJsonError,
} from "@/lib/http";
import {
  AdminDeletionError,
  hideAdminHistoryEntry,
} from "@/lib/services/admin-deletion-service";

const historyDeletionSchema = z
  .object({
    assignmentId: z.uuid(),
    studentId: z.uuid(),
    attemptId: z.uuid().nullable(),
  })
  .strict();

const historyReadBaseSchema = z.object({
  currentOnly: z.boolean(),
  query: z.string().max(80),
  statusFilter: z.enum(adminHistoryStatusFilters),
});

const historyReadSchema = z.discriminatedUnion("mode", [
  historyReadBaseSchema.extend({
    mode: z.literal("initial"),
  }).strict(),
  historyReadBaseSchema.extend({
    cursor: z.string().min(1).max(2048),
    groupKey: z.string().min(1).max(40),
    mode: z.literal("page"),
  }).strict(),
  historyReadBaseSchema.extend({
    groupKey: z.string().min(1).max(40),
    mode: z.literal("section"),
    snapshotAt: z.iso.datetime({ offset: true }),
  }).strict(),
]);

const privateNoStoreHeaders = {
  "Cache-Control": "private, no-store",
} as const;

export async function POST(request: Request) {
  if (!isSameOriginRequest(request)) {
    return privateJsonError("허용되지 않은 요청입니다.", 403);
  }
  let admin: AdminContext | null;
  try {
    admin = await getAdminContextOrThrow(request.signal);
  } catch (error) {
    if (error instanceof AdminAuthenticationUnavailableError) {
      return privateJsonError(
        error.message,
        503,
        {
          code: error.code === "UPSTREAM_TIMEOUT"
            ? "upstream_timeout"
            : "admin_auth_unavailable",
        },
      );
    }
    return privateJsonError(
      "관리자 인증을 확인하지 못했습니다. 잠시 후 다시 시도해 주세요.",
      503,
      { code: "admin_auth_unavailable" },
    );
  }
  if (!admin) {
    return privateJsonError("관리자 로그인이 필요합니다.", 401);
  }
  const input = await parseJson(request, historyReadSchema);
  if (!input) {
    return privateJsonError("내역 검색 조건을 확인해 주세요.", 400);
  }

  try {
    if (input.mode === "initial") {
      const snapshot = await listAdminHistoryInitial(input, admin, request.signal);
      return Response.json({ snapshot }, { headers: privateNoStoreHeaders });
    }
    if (input.mode === "section") {
      const section = await listAdminHistoryFreshSection(
        input,
        admin,
        request.signal,
      );
      return Response.json({ section }, { headers: privateNoStoreHeaders });
    }
    const page = await listAdminHistoryNextPage(input, admin, request.signal);
    return Response.json({ page }, { headers: privateNoStoreHeaders });
  } catch (error) {
    if (error instanceof AdminHistoryCursorError) {
      return privateJsonError(error.message, 400);
    }
    if (error instanceof AdminHistoryReadError) {
      return privateJsonError(
        error.message,
        error.reason === "input" ? 400 : 503,
        error.reason === "timeout" ? { code: "upstream_timeout" } : {},
      );
    }
    return privateJsonError(
      "시험 내역을 불러오지 못했습니다. 잠시 뒤 다시 시도해 주세요.",
      503,
    );
  }
}

export async function DELETE(request: Request) {
  if (!isSameOriginRequest(request)) {
    return privateJsonError("허용되지 않은 요청입니다.", 403);
  }
  const admin = await getAdminContext();
  if (!admin) {
    return privateJsonError("관리자 로그인이 필요합니다.", 401);
  }
  const input = await parseJson(request, historyDeletionSchema);
  if (!input) {
    return privateJsonError("삭제할 내역을 확인해 주세요.", 400);
  }

  try {
    return Response.json(
      await hideAdminHistoryEntry(input, admin),
      {
        headers: privateNoStoreHeaders,
      },
    );
  } catch (error) {
    if (error instanceof AdminDeletionError) {
      const status =
        error.reason === "forbidden"
          ? 403
          : error.reason === "not_found"
            ? 404
            : error.reason === "conflict"
              ? 409
            : 503;
      return privateJsonError(error.message, status);
    }
    return privateJsonError(
      "내역을 삭제하지 못했습니다. 잠시 뒤 다시 시도해 주세요.",
      503,
    );
  }
}
