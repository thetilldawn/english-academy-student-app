import "server-only";

import { getServiceSupabaseClient } from "@/lib/supabase/service";

const STALE_BATCH_SIZE = 1000;
const STALE_MAX_BATCHES_PER_REQUEST = 3;

function parseFinalizedCount(value: unknown) {
  const count = typeof value === "number" ? value : Number(value);
  if (!Number.isSafeInteger(count) || count < 0) {
    throw new Error("시간이 지난 시험의 처리 결과를 확인하지 못했습니다.");
  }
  return count;
}

export async function finalizeStaleQuizAttempts() {
  const supabase = getServiceSupabaseClient();
  let finalizedCount = 0;

  for (
    let batchNumber = 0;
    batchNumber < STALE_MAX_BATCHES_PER_REQUEST;
    batchNumber += 1
  ) {
    const { data, error } = await supabase.rpc(
      "finalize_stale_quiz_attempts",
      { p_limit: STALE_BATCH_SIZE },
    );

    if (error) {
      throw new Error("시간이 지난 시험을 확정하지 못했습니다.");
    }

    const currentBatchCount = parseFinalizedCount(data);
    finalizedCount += currentBatchCount;
    if (currentBatchCount < STALE_BATCH_SIZE) {
      return {
        finalizedCount,
        backlogMayRemain: false,
      };
    }
  }

  return {
    finalizedCount,
    backlogMayRemain: true,
  };
}

export async function finalizeQuizAttemptIfStale(attemptId: string) {
  const supabase = getServiceSupabaseClient();
  const { data, error } = await supabase.rpc(
    "finalize_quiz_attempt_if_stale",
    { p_attempt_id: attemptId },
  );

  if (error || typeof data !== "boolean") {
    throw new Error("시간이 지난 시험을 확정하지 못했습니다.");
  }

  return data;
}
