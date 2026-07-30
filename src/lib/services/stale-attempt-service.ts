import "server-only";

import { ServerOperationError } from "@/lib/observability/server-log";
import { getServiceSupabaseClient } from "@/lib/supabase/service";

const STALE_BATCH_SIZE = 1000;
const STALE_MAX_BATCHES_PER_REQUEST = 3;

function parseFinalizedCount(value: unknown) {
  const count = typeof value === "number" ? value : Number(value);
  if (!Number.isSafeInteger(count) || count < 0) {
    throw new ServerOperationError(
      "시간이 지난 시험의 처리 결과를 확인하지 못했습니다.",
      {
        operation: "quiz.stale.finalize",
        code: "STALE_ATTEMPT_INVALID_RESULT",
      },
    );
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
      throw new ServerOperationError(
        "시간이 지난 시험을 확정하지 못했습니다.",
        {
          operation: "quiz.stale.finalize",
          code: "STALE_ATTEMPT_FINALIZE_FAILED",
          cause: error,
        },
      );
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

  if (error) {
    throw new ServerOperationError(
      "시간이 지난 시험을 확정하지 못했습니다.",
      {
        operation: "quiz.stale.finalize_one",
        code: "STALE_ATTEMPT_FINALIZE_ONE_FAILED",
        cause: error,
      },
    );
  }

  if (typeof data !== "boolean") {
    throw new ServerOperationError(
      "시간이 지난 시험의 처리 결과를 확인하지 못했습니다.",
      {
        operation: "quiz.stale.finalize_one",
        code: "STALE_ATTEMPT_INVALID_RESULT",
      },
    );
  }

  return data;
}
