import "server-only";

import { getServiceSupabaseClient } from "@/lib/supabase/service";

const MISSED_STUDENT_REQUEST_BATCH_SIZE = 25;

function parseFinalizedCount(value: unknown) {
  const count = typeof value === "number" ? value : Number(value);
  if (!Number.isSafeInteger(count) || count < 0) {
    throw new Error("미응시 처리 결과를 확인하지 못했습니다.");
  }
  return count;
}

export async function finalizeStudentMissedAssignments(
  studentId: string,
) {
  const supabase = getServiceSupabaseClient();
  const { data, error } = await supabase.rpc(
    "finalize_missed_assignments",
    {
      p_student_id: studentId,
      p_limit: MISSED_STUDENT_REQUEST_BATCH_SIZE,
    },
  );

  if (error) {
    throw new Error("마감된 미응시 배정을 확정하지 못했습니다.");
  }

  const finalizedCount = parseFinalizedCount(data);
  return {
    finalizedCount,
    batchLimitReached:
      finalizedCount === MISSED_STUDENT_REQUEST_BATCH_SIZE,
  };
}
