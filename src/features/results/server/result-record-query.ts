import "server-only";
import { getServiceSupabaseClient } from "@/lib/supabase/service";
import { vocabularyResultRecordSchema } from "../contracts/result-record";

export async function getVocabularyResultRecord(attemptId: string, actor: { kind: "student" | "admin"; id: string }) {
  const { data, error } = await getServiceSupabaseClient().rpc("read_vocabulary_result_record_v1", {
    p_actor_kind: actor.kind, p_actor_id: actor.id, p_attempt_id: attemptId,
  });
  if (error) throw new Error("시험 결과를 불러오지 못했습니다.", { cause: error });
  if (data === null) return null;
  const parsed = vocabularyResultRecordSchema.safeParse(data);
  if (!parsed.success || parsed.data.phases.some(phase => phase.attemptId !== attemptId)) {
    throw new Error("시험 결과를 불러오지 못했습니다.");
  }
  return parsed.data;
}
