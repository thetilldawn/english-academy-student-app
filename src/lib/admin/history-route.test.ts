import { describe, expect, it } from "vitest";

import {
  historyDetailHref,
  historyEntryKey,
  parseHistoryEntryKey,
} from "@/lib/admin/history-route";

const attemptId = "11111111-1111-4111-8111-111111111111";
const assignmentId = "22222222-2222-4222-8222-222222222222";
const studentId = "33333333-3333-4333-8333-333333333333";

describe("history route keys", () => {
  it("builds canonical attempt and assignment keys", () => {
    expect(
      historyEntryKey({ attemptId, assignmentId, studentId }),
    ).toBe(`attempt.${attemptId}`);
    expect(
      historyEntryKey({ attemptId: null, assignmentId, studentId }),
    ).toBe(`assignment.${assignmentId}.${studentId}`);
    expect(
      historyDetailHref({ attemptId: null, assignmentId, studentId }),
    ).toBe(`/admin/results/assignment.${assignmentId}.${studentId}`);
  });

  it("parses canonical keys and legacy bare attempt UUIDs", () => {
    expect(parseHistoryEntryKey(`attempt.${attemptId}`)).toEqual({
      kind: "attempt",
      attemptId,
    });
    expect(parseHistoryEntryKey(attemptId)).toEqual({
      kind: "attempt",
      attemptId,
    });
    expect(
      parseHistoryEntryKey(`assignment.${assignmentId}.${studentId}`),
    ).toEqual({ kind: "assignment", assignmentId, studentId });
  });

  it("rejects malformed or ambiguous keys", () => {
    expect(parseHistoryEntryKey("attempt.not-a-uuid")).toBeNull();
    expect(parseHistoryEntryKey(`assignment.${assignmentId}`)).toBeNull();
    expect(parseHistoryEntryKey("anything-else")).toBeNull();
  });
});
