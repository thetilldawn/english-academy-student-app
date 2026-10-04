export function quizTimeBar(remainingMs: number, limitMs: number | null, correct: boolean | null) {
  if (correct !== null) return { visible: true, ratio: 1, tone: correct ? "green" : "red", urgent: false, feedback: true } as const;
  if (!limitMs || !Number.isFinite(remainingMs)) return { visible: false, ratio: 0, tone: "green", urgent: false, feedback: false } as const;
  const ratio = Math.max(0, Math.min(1, remainingMs / limitMs));
  return { visible: true, ratio, tone: ratio > .5 ? "green" : ratio > .25 ? "yellow" : ratio > .1 ? "orange" : "red",
    urgent: remainingMs > 0 && remainingMs <= 3000 && ratio <= .1, feedback: false } as const;
}
