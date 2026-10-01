import type { QuizTransport } from "../api/quiz-transport";
import { QUIZ_REQUEST_TIMEOUT_MS } from "../domain/quiz-session";
import type { QuizAttempt } from "../model";
import type { QuizRecoverySnapshot } from "./use-quiz-recovery";

type Observation =
  | { kind: "answer"; response: Awaited<ReturnType<QuizTransport["answer"]>> }
  | { kind: "recovered"; snapshot: QuizRecoverySnapshot };

/** A slow request is still live. Only a confirmed saved answer can win its race. */
export function observeQuizAnswer(input: {
  answer: () => ReturnType<QuizTransport["answer"]>;
  read: () => ReturnType<QuizTransport["read"]>;
  isSaved: (attempt: QuizAttempt) => boolean;
  isActive: () => boolean;
  onSlow: () => void;
}): Promise<Observation> {
  return new Promise((resolve, reject) => {
    let settled = false;
    const finish = (value: Observation) => {
      if (settled) return;
      settled = true;
      clearTimeout(slowTimer);
      resolve(value);
    };
    const slowTimer = setTimeout(() => {
      if (settled || !input.isActive()) return;
      input.onSlow();
      void input.read().then(response => {
        if (!settled && input.isActive() && response.ok && input.isSaved(response.payload.attempt)) {
          finish({ kind: "recovered", snapshot: response });
        }
      }).catch(() => { /* The original response remains authoritative. */ });
    }, QUIZ_REQUEST_TIMEOUT_MS);
    void input.answer().then(response => finish({ kind: "answer", response }), error => {
      if (settled) return;
      settled = true;
      clearTimeout(slowTimer);
      reject(error);
    });
  });
}
