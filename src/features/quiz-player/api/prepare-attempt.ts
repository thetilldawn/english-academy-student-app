import { awaitWithAbortSignal, createRequestDeadline } from "@/lib/network/request-policy";
import { readyQuizSchema, type PreparedQuiz } from "../contracts/preparation";

export class PreparationChanged extends Error {}

export async function beginPreparedAttempt(preparation: Pick<PreparedQuiz, "id" | "kind">) {
  const deadline = createRequestDeadline(20_000);
  try {
    const family = preparation.kind === "practice" ? "practice" : "attempts";
    const response = await awaitWithAbortSignal(fetch(`/api/student/${family}/${preparation.id}/ready`, {
      method: "POST", headers: { "content-type": "application/json" }, cache: "no-store",
      signal: deadline.signal, body: JSON.stringify({ kind: preparation.kind }),
    }), deadline.signal);
    const value: unknown = await awaitWithAbortSignal(response.json(), deadline.signal);
    if (!response.ok) {
      if (response.status === 409 && value && typeof value === "object" &&
          "code" in value && value.code === "preparation_changed") throw new PreparationChanged();
      throw new Error("시험을 준비하지 못했습니다. 다시 확인해 주세요.");
    }
    return { clock: readyQuizSchema.parse(value), receivedAt: performance.now() };
  } finally {
    deadline.dispose();
  }
}
