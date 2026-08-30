import "server-only";

import type { AdminHistoryDetail } from "@/features/history/model";
import {
  historyEntryKey,
  parseHistoryEntryKey,
} from "@/lib/admin/history-route";
import { requireAdmin } from "@/lib/auth/admin";
import { getAdminAttemptDetail } from "./admin-attempt-detail-query";
import { getAdminAttemptPointSummary } from "@/lib/services/learning-point-read-service";
import { createServerSupabaseClient } from "@/lib/supabase/server";

import { AdminHistoryReadError } from "./admin-history-read-error";
import {
  adminHistoryDetailItemSchema,
  mapAdminHistoryDetailItem,
} from "./admin-history-row-schema";

export async function getAdminHistoryReadModelDetail(
  entryKey: string,
): Promise<AdminHistoryDetail | null> {
  const parsedKey = parseHistoryEntryKey(entryKey);
  if (!parsedKey) return null;
  const admin = await requireAdmin();
  const supabase = await createServerSupabaseClient();
  const { data, error } = await supabase.rpc(
    "get_admin_history_detail_v1",
    parsedKey.kind === "attempt"
      ? {
          p_assignment_id: null,
          p_attempt_id: parsedKey.attemptId,
          p_student_id: null,
        }
      : {
          p_assignment_id: parsedKey.assignmentId,
          p_attempt_id: null,
          p_student_id: parsedKey.studentId,
        },
  );
  if (error) {
    throw new AdminHistoryReadError("시험 내역 상세를 불러오지 못했습니다.");
  }
  if (data === null) return null;
  const parsedSummary = adminHistoryDetailItemSchema.safeParse(data);
  if (!parsedSummary.success) {
    throw new AdminHistoryReadError(
      "시험 내역 상세 응답을 확인하지 못했습니다.",
      "contract",
    );
  }
  const summary = mapAdminHistoryDetailItem(parsedSummary.data);
  const [attempt, pointSummary] = summary.attemptId
    ? await Promise.all([
        getAdminAttemptDetail(summary.attemptId, admin),
        getAdminAttemptPointSummary(summary.studentId, summary.attemptId),
      ])
    : [null, null];

  return {
    attempt,
    canonicalKey: historyEntryKey(summary),
    pointSummary,
    summary,
  };
}
