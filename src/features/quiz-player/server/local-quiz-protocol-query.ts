import "server-only";
import { z } from "zod";
import { getServiceSupabaseClient } from "@/lib/supabase/service";

export async function usesLocalQuiz(studentId: string, attemptId: string) {
  const { data, error } = await getServiceSupabaseClient().rpc("get_local_quiz_protocol_v1", { p_student_id: studentId, p_attempt_id: attemptId });
  if (error) throw new Error("local_quiz_protocol_unavailable");
  return z.boolean().parse(data);
}
