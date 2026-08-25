import "server-only";

import type {
  AdminAttemptPointSummary,
  StudentAttemptPointSummary,
} from "@/features/learning-points/model";
import { getServiceSupabaseClient } from "@/lib/supabase/service";

type PointTotalRow = {
  student_id: string;
  current_points: number | string;
};

type AttemptPointSummaryRow = {
  event_count: number | string;
  correct_reward: number | string;
  wrong_effect: number | string;
  net_change: number | string;
  current_points: number | string;
};

function parseSafeInteger(value: number | string, field: string) {
  const parsed = typeof value === "number" ? value : Number(value);
  if (!Number.isSafeInteger(parsed)) {
    throw new Error(`포인트 ${field} 값이 올바르지 않습니다.`);
  }
  return parsed;
}

function uniqueStudentIds(studentIds: string[]) {
  return [...new Set(studentIds.filter((studentId) => studentId.length > 0))];
}

export async function listStudentPointBalances(
  studentIds: string[],
): Promise<Map<string, number>> {
  const uniqueIds = uniqueStudentIds(studentIds);
  const balances = new Map(uniqueIds.map((studentId) => [studentId, 0]));
  if (uniqueIds.length === 0) return balances;

  const supabase = getServiceSupabaseClient();
  const { data, error } = await supabase.rpc(
    "list_student_point_totals_v1",
    { p_student_ids: uniqueIds },
  );
  if (error) {
    throw new Error("학생 포인트를 불러오지 못했습니다.");
  }

  for (const row of (data ?? []) as PointTotalRow[]) {
    if (!balances.has(row.student_id)) continue;
    balances.set(
      row.student_id,
      Math.max(0, parseSafeInteger(row.current_points, "합계")),
    );
  }
  return balances;
}

export async function getStudentPointBalance(studentId: string) {
  const balances = await listStudentPointBalances([studentId]);
  return balances.get(studentId) ?? 0;
}

async function getAttemptPointSummaryRow(
  studentId: string,
  attemptId: string,
): Promise<AttemptPointSummaryRow | null> {
  const supabase = getServiceSupabaseClient();
  const { data, error } = await supabase.rpc(
    "get_quiz_attempt_point_summary_v1",
    {
      p_attempt_id: attemptId,
      p_student_id: studentId,
    },
  );
  if (error) {
    throw new Error("시험 포인트를 불러오지 못했습니다.");
  }

  const row = ((data ?? []) as AttemptPointSummaryRow[])[0];
  if (!row) return null;
  const eventCount = parseSafeInteger(row.event_count, "기록 수");
  if (eventCount === 0) return null;

  return row;
}

export async function getStudentAttemptPointSummary(
  studentId: string,
  attemptId: string,
): Promise<StudentAttemptPointSummary | null> {
  const row = await getAttemptPointSummaryRow(studentId, attemptId);
  if (!row) return null;

  return {
    attemptPoints: Math.max(
      0,
      parseSafeInteger(row.net_change, "시험 합계"),
    ),
    currentPoints: Math.max(
      0,
      parseSafeInteger(row.current_points, "현재 합계"),
    ),
  };
}

export async function getAdminAttemptPointSummary(
  studentId: string,
  attemptId: string,
): Promise<AdminAttemptPointSummary | null> {
  const row = await getAttemptPointSummaryRow(studentId, attemptId);
  if (!row) return null;

  return {
    correctReward: parseSafeInteger(row.correct_reward, "정답 보상"),
    wrongEffect: parseSafeInteger(row.wrong_effect, "오답 반영"),
    netChange: parseSafeInteger(row.net_change, "시험 합계"),
    currentPoints: Math.max(
      0,
      parseSafeInteger(row.current_points, "현재 합계"),
    ),
  };
}
