import { pruneLocalQuizContents } from "./local-quiz-store";

let pending: AbortController | null = null;
let timer: ReturnType<typeof setTimeout> | null = null;
export function cancelLocalQuizMaintenance() {
  if (timer !== null) clearTimeout(timer);
  timer = null;
  pending?.abort(); pending = null;
}
/** Only the student list schedules housekeeping; an exam read takes priority. */
export function scheduleLocalQuizMaintenance() {
  cancelLocalQuizMaintenance();
  const controller = new AbortController(); pending = controller;
  timer = setTimeout(() => {
    timer = null;
    if (!navigator.locks) { if (pending === controller) pending = null; return; }
    // The same origin's other exam tabs hold this existing shared lock too.
    // Web Locks forbids combining ifAvailable with signal. Cancellation is
    // checked on grant and passed to the actual storage transaction instead.
    void navigator.locks.request("quiz-offline-assets-v1", { mode: "exclusive", ifAvailable: true },
      async lock => { if (lock && !controller.signal.aborted) await pruneLocalQuizContents(Date.now(), controller.signal); }).catch(() => {
      // A later list visit can retry cleanup. It never owns unsent answers.
    }).finally(() => { if (pending === controller) pending = null; });
  }, 5000);
  return () => { if (pending === controller) cancelLocalQuizMaintenance(); };
}
