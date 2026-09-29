import "server-only";
import { cache } from "react";

import type {
  AdminAttemptPointSummary,
  StudentAttemptPointSummary,
} from "@/features/learning-points/model";
import { getServiceSupabaseClient } from "@/lib/supabase/service";

type AttemptPointSummaryRow = {
  event_count: number;
  correct_reward: number;
  wrong_effect: number;
  net_change: number;
  current_points: number;
};

function parseSafeInteger(value: unknown, field: string) {
  if (typeof value !== "number" && (typeof value !== "string" || !/^-?\d+$/.test(value))) {
    throw new Error(`포인트 ${field} 값이 올바르지 않습니다.`);
  }
  const parsed = typeof value === "number" ? value : Number(value);
  if (!Number.isSafeInteger(parsed)) {
    throw new Error(`포인트 ${field} 값이 올바르지 않습니다.`);
  }
  return parsed;
}

function isRow(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function uniqueStudentIds(studentIds: string[]) {
  return [...new Set(studentIds.filter((studentId) => studentId.length > 0))];
}

export async function listStudentPointBalances(
  studentIds: string[],
): Promise<Map<string, number>> {
  const uniqueIds = uniqueStudentIds(studentIds);
  const balances = new Map<string, number>();
  if (uniqueIds.length === 0) return balances;

  const supabase = getServiceSupabaseClient();
  const { data, error } = await supabase.rpc(
    "list_student_point_totals_v1",
    { p_student_ids: uniqueIds },
  );
  if (error || !Array.isArray(data) || data.length !== uniqueIds.length) {
    throw new Error("학생 포인트를 불러오지 못했습니다.");
  }

  const requested = new Set(uniqueIds);
  for (const row of data as unknown[]) {
    if (!isRow(row) || typeof row.student_id !== "string" || !requested.has(row.student_id) || balances.has(row.student_id)) {
      throw new Error("학생 포인트 응답이 올바르지 않습니다.");
    }
    const points = parseSafeInteger(row.current_points, "합계");
    if (points < 0) throw new Error("포인트 합계 값이 올바르지 않습니다.");
    balances.set(row.student_id, points);
  }
  return new Map(uniqueIds.map(id => [id, balances.get(id)!]));
}

export const getStudentPointBalance = cache(async (studentId: string) => {
  const balances = await listStudentPointBalances([studentId]);
  const points = balances.get(studentId);
  if (points === undefined) throw new Error("학생 포인트를 불러오지 못했습니다.");
  return points;
});

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
  if (error || !Array.isArray(data) || data.length !== 1 || !isRow(data[0])) {
    throw new Error("시험 포인트를 불러오지 못했습니다.");
  }

  const raw = data[0];
  const row: AttemptPointSummaryRow = {
    event_count: parseSafeInteger(raw.event_count, "기록 수"),
    correct_reward: parseSafeInteger(raw.correct_reward, "정답 보상"),
    wrong_effect: parseSafeInteger(raw.wrong_effect, "오답 반영"),
    net_change: parseSafeInteger(raw.net_change, "시험 합계"),
    current_points: parseSafeInteger(raw.current_points, "현재 합계"),
  };
  if (row.event_count < 0 || row.correct_reward < 0 || row.wrong_effect > 0 || row.current_points < 0 ||
      row.correct_reward + row.wrong_effect !== row.net_change ||
      row.event_count === 0 && (row.correct_reward !== 0 || row.wrong_effect !== 0 || row.net_change !== 0)) {
    throw new Error("시험 포인트 응답이 올바르지 않습니다.");
  }
  if (row.event_count === 0) return null;

  return row;
}

export const getStudentAttemptPointSummary = cache(async (
  studentId: string,
  attemptId: string,
): Promise<StudentAttemptPointSummary | null> => {
  const row = await getAttemptPointSummaryRow(studentId, attemptId);
  if (!row) return null;

  return {
    attemptPoints: Math.max(0, row.net_change),
    currentPoints: row.current_points,
  };
});

export async function getAdminAttemptPointSummary(
  studentId: string,
  attemptId: string,
): Promise<AdminAttemptPointSummary | null> {
  const row = await getAttemptPointSummaryRow(studentId, attemptId);
  if (!row) return null;

  return {
    correctReward: row.correct_reward,
    wrongEffect: row.wrong_effect,
    netChange: row.net_change,
    currentPoints: row.current_points,
  };
}
