import { describe, expect, it } from "vitest";
import { assignmentQuestionModes, type AssignmentDirectionRatio } from "./model";
import { assignmentQuestionModeAvailability, assignmentQuestionModeIssues, assignmentQuestionModePolicy, type QuestionModeSchedulePlan } from "./assignment-question-mode-policy";

const immediate: QuestionModeSchedulePlan = {
  selectedDateCount: 0, distribution: "repeat", splitBasis: "question_count",
  sessions: [{ availableFrom: null, availableUntil: null }],
  recurrenceSessions: [{ availableFrom: null, availableUntil: null }],
};
const patches: [string, Partial<QuestionModeSchedulePlan>][] = [
  ["valid", {}], ["date", { selectedDateCount: 1 }], ["split", { distribution: "split" }],
  ["range", { splitBasis: "range_unit" }], ["no session", { sessions: [] }],
  ["two sessions", { sessions: [...immediate.sessions, ...immediate.sessions] }],
  ["no recurrence", { recurrenceSessions: [] }],
  ["two recurrence", { recurrenceSessions: [...immediate.recurrenceSessions, ...immediate.recurrenceSessions] }],
  ["start", { sessions: [{ availableFrom: "2026-09-10T00:00:00Z", availableUntil: null }] }],
  ["end", { sessions: [{ availableFrom: null, availableUntil: "2026-09-11T00:00:00Z" }] }],
  ["recurrence start", { recurrenceSessions: [{ availableFrom: "2026-09-10T00:00:00Z", availableUntil: null }] }],
  ["recurrence end", { recurrenceSessions: [{ availableFrom: null, availableUntil: "2026-09-11T00:00:00Z" }] }],
];
// Example restrictions remain; definition directions now reuse the common schedule.
function previousScheduleInvalid(mode: string, p: QuestionModeSchedulePlan) {
  return mode === "canonical_example_to_headword" && (p.selectedDateCount !== 0 || p.distribution !== "repeat" ||
    p.splitBasis !== "question_count" || p.sessions.length !== 1 || p.recurrenceSessions.length !== 1 ||
    p.sessions.some(s => s.availableFrom !== null || s.availableUntil !== null) ||
    p.recurrenceSessions.some(s => s.availableFrom !== null || s.availableUntil !== null));
}

describe("assignment question mode policy", () => {
  it.each(patches)("keeps the mode-specific direction and schedule boundary: %s", (_name, patch) => {
    for (const mode of assignmentQuestionModes) for (const ratio of [0, 50, 100] as AssignmentDirectionRatio[]) {
      const plan = { ...immediate, ...patch };
      const before = JSON.stringify(plan);
      expect(assignmentQuestionModeIssues(mode, ratio, plan)).toEqual({
        direction: mode !== "book_meaning_choice" && ratio !== (mode === "canonical_headword_to_definition" ? 100 : 0),
        schedule: previousScheduleInvalid(mode, plan),
      });
      expect(JSON.stringify(plan)).toBe(before);
    }
  });
  it("leaves missing-plan validation with its existing owner", () => {
    expect(assignmentQuestionModeIssues("canonical_example_to_headword", 0)).toEqual({ direction: false, schedule: false });
  });
  it("exposes the approved UI and reducer restrictions", () => {
    expect(assignmentQuestionModePolicy("book_meaning_choice")).toEqual({ fixedDirectionRatio: null, schedule: "flexible" });
    for (const mode of assignmentQuestionModes.slice(1)) {
      expect(assignmentQuestionModePolicy(mode)).toEqual({ fixedDirectionRatio: mode === "canonical_headword_to_definition" ? 100 : 0, schedule: mode === "canonical_example_to_headword" ? "single-immediate" : "flexible" });
    }
  });
  it("separates no selection, missing preparation, valid empty and available modes", () => {
    expect(assignmentQuestionModeAvailability({ datasetSelected: false, availableModes: assignmentQuestionModes }))
      .toEqual({ status: "unselected", availableModes: [] });
    expect(assignmentQuestionModeAvailability({ datasetSelected: true })).toEqual({ status: "unavailable", availableModes: [] });
    expect(assignmentQuestionModeAvailability({ datasetSelected: true, availableModes: [] })).toEqual({ status: "ready", availableModes: [] });
    expect(assignmentQuestionModeAvailability({ datasetSelected: true, availableModes: assignmentQuestionModes }).availableModes)
      .toEqual(assignmentQuestionModes);
  });
});
