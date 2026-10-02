import { localPhasePlanSchema, type LocalPhasePlan } from "../../contracts/local-quiz";
import { requestLocalQuiz } from "../../api/local-quiz";
/** An upper bound small enough for the server's 1s clock tolerance. Slow starts
 * are read again before play, using the same immutable start/phase receipt. */
export async function anchorLocalQuizClock(plan: LocalPhasePlan, sentAt: number, device: string, signal: AbortSignal) {
  let current = plan; let sent = sentAt;
  for (let tries = 0; tries < 3; tries++) {
    const roundTrip = performance.now() - sent;
    if (roundTrip <= 800) return { plan: current, elapsed: Math.ceil(Math.max(0, Date.parse(current.serverNow) - Date.parse(current.startedAt)) + roundTrip) };
    if (tries === 2) break;
    sent = performance.now();
    current = localPhasePlanSchema.parse(await requestLocalQuiz({ action: "read", attemptId: plan.attemptId, phase: plan.phase, device }, signal));
    if (current.planHash !== plan.planHash || current.startedAt !== plan.startedAt) throw new Error("local_plan_conflict");
  }
  throw new Error("local_clock_anchor_slow");
}
