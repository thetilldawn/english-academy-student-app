import "server-only";

import { mapAdminHistoryDetailItem } from "@/features/history/server/queries/admin-history-row-schema";
import { requireAdmin } from "@/lib/auth/admin";
import { unitSelectionRangeLabel } from "@/lib/admin/history";
import { createServerSupabaseClient } from "@/lib/supabase/server";

import type { StudentDetailInitial } from "../../contracts/student-detail-read-model";
import { emptyStudentHistoryFilters } from "../../contracts/student-detail-read-model";
import {
  encodeStudentHistoryCursor,
  studentHistoryFilterFingerprint,
} from "../student-history-cursor";
import { StudentDetailReadError } from "./student-detail-read-error";
import { studentDetailInitialRowSchema } from "./student-detail-row-schema";

export async function getStudentDetailInitial(
  studentId: string,
): Promise<StudentDetailInitial | null> {
  await requireAdmin();
  const supabase = await createServerSupabaseClient();
  const { data, error } = await supabase.rpc(
    "get_admin_student_detail_initial_v2",
    { p_snapshot_at: null, p_student_id: studentId },
  );
  if (error) {
    throw new StudentDetailReadError("학생 정보를 불러오지 못했습니다.");
  }
  if (data === null) return null;
  const parsed = studentDetailInitialRowSchema.safeParse(data);
  if (!parsed.success) {
    throw new StudentDetailReadError(
      "학생 정보 응답을 확인하지 못했습니다.",
      "contract",
    );
  }
  const vocabBookHistory = parsed.data.vocabBookHistory.map((row) => {
    const usePrimary = row.assignmentPurpose === "mixed" ||
      row.primaryUnitLabels.length > 0;
    return {
      attemptCount: row.attemptCount,
      datasetId: row.datasetId,
      datasetTitle: row.datasetTitle,
      lastActivityAt: row.lastActivityAt,
      lastPassed: row.lastPassed,
      lastScopeLabel: unitSelectionRangeLabel(
        usePrimary ? row.primaryUnitLabels : row.unitLabels,
        (usePrimary
          ? row.primaryUnitSortIndexes
          : row.unitSortIndexes) ?? [],
      ),
      lastStatus: row.lastStatus,
      studentId: row.studentId,
    };
  });
  const historyItems = parsed.data.history.items;
  const lastVisible = historyItems[9];
  const history = {
    items: historyItems
      .slice(0, 10)
      .map((node) => mapAdminHistoryDetailItem(node.item)),
    nextCursor:
      historyItems.length > 10 && lastVisible
        ? encodeStudentHistoryCursor({
            effectiveAt: lastVisible.effectiveAt,
            entryKey: lastVisible.entryKey,
            filterFingerprint: studentHistoryFilterFingerprint(
              emptyStudentHistoryFilters,
            ),
            snapshotAt: parsed.data.snapshotAt,
            studentId,
            version: 1,
          })
        : null,
    totalCount: parsed.data.history.totalCount,
  };
  return {
    history,
    learningSources: parsed.data.learningSources,
    snapshotAt: parsed.data.snapshotAt,
    student: parsed.data.student,
    vocabBookHistory,
    wrongSummary: parsed.data.wrongSummary,
  };
}
