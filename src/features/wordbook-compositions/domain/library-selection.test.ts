import { describe, expect, it } from "vitest";
import { EMPTY_LIBRARY_FILTERS, libraryScopeSchema, type LibraryRecipe } from "../contracts/library";
import { matchesLibraryScope, resolveLibraryRecipe, planLibraryUnits } from "./library-selection";
import { changeVisibleSelection } from "./scope-selection";

const uuid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const row = (n: number) => ({ key: n.toString(16).padStart(64, "0"), sourceRow: n, sourceEntryId: n, rowHash: "a".repeat(64), state: "included" as const });
const scope = (n: number, year: number, month: number) => libraryScopeSchema.parse({
  id: uuid(n), version: "a".repeat(64), name: "장문독해", sourceTitle: `가짜 ${year}년 ${month}월`, availability: "available",
  source: { datasetId: uuid(99), unitId: uuid(n), kind: "exam_use", releaseId: uuid(98), releaseVersion: "b".repeat(64), fileHash: "c".repeat(64), locator: `q${n}` },
  classification: { kind: "mock", sourceGrade: "g12", exam: { executionYear: year, examMonth: month, examKind: "mock", academicYear: null, agency: "가짜", typeCode: "long", typeLabel: "장문독해", questionNumbers: [41, 42], sharedPassage: true },
    lesson: null, day: null, publisher: null, school: null, targetGrade: "g11", schoolYear: 2026, semester: 2, assessment: "수행평가", purpose: "직전 대비" },
  occurrences: [row(n)],
});

describe("source occurrence selection", () => {
  it("intersects dimensions, unions selected values, and retains shared long passages for either question", () => {
    const all = [scope(1, 2024, 9), scope(2, 2025, 9), scope(3, 2026, 6)];
    const f = { ...EMPTY_LIBRARY_FILTERS, yearFrom: 2024, yearTo: 2025, months: [6, 9], questions: [42], types: ["long"], targetGrades: ["g11"] };
    expect(all.filter(s => matchesLibraryScope(s, f)).map(s => s.id)).toEqual([uuid(1), uuid(2)]);
    expect(all.filter(s => matchesLibraryScope(s, { ...f, sourceGrades: ["g11"] }))).toEqual([]);
    expect(matchesLibraryScope(all[0]!, { ...f, yearFrom: 2026, yearTo: 2024 })).toBe(false);
  });
  it("does not treat supplements as DAY or lose unclassified sources by default", () => {
    const supplement = scope(1, 2025, 9); supplement.classification = { ...supplement.classification, kind: "unclassified", exam: null };
    expect(matchesLibraryScope(supplement, EMPTY_LIBRARY_FILTERS)).toBe(true);
    expect(matchesLibraryScope(supplement, { ...EMPTY_LIBRARY_FILTERS, dayFrom: 1, dayTo: 5 })).toBe(false);
    const day = { ...supplement, classification: { ...supplement.classification, kind: "wordbook" as const, day: 3 } };
    expect(matchesLibraryScope(day, { ...EMPTY_LIBRARY_FILTERS, dayFrom: 1, dayTo: 5 })).toBe(true);
  });
  it("preserves hidden selections and distinguishes visible removal from emptying the basket", () => {
    expect(changeVisibleSelection([uuid(1), uuid(3)], [uuid(2)], true)).toEqual([uuid(1), uuid(3), uuid(2)]);
    expect(changeVisibleSelection([uuid(1), uuid(3)], [uuid(1), uuid(2)], false)).toEqual([uuid(3)]);
  });
  it("deduplicates the same source row, preserves another manuscript and never includes held or excluded rows", () => {
    const first = scope(1, 2025, 9), second = scope(2, 2025, 9);
    first.occurrences.push({ ...row(3), state: "held", sourceEntryId: null }, { ...row(4), state: "excluded", sourceEntryId: null });
    second.occurrences.unshift(row(1));
    const recipe: LibraryRecipe = { filters: EMPTY_LIBRARY_FILTERS, scopes: [first, second].map(s => ({ id: s.id, version: s.version })), excludedOccurrenceKeys: [], scopeStatus: "confirmed" };
    const resolved = resolveLibraryRecipe([first, second], recipe);
    expect(resolved).toMatchObject({ sourceCount: 4, includedCount: 2, heldCount: 1, excludedCount: 1 });
    expect(resolved.rowScopes.get(row(1).key)).toEqual([first.id, second.id]);
    expect(resolveLibraryRecipe([first, second], { ...recipe, excludedOccurrenceKeys: [row(1).key] }).includedCount).toBe(1);
    expect(() => resolveLibraryRecipe([first], recipe)).toThrow("missing");
    expect(() => resolveLibraryRecipe([first, { ...second, version: "b".repeat(64) }], recipe)).toThrow("changed");
    expect(() => resolveLibraryRecipe([first, { ...second, availability: "retired" }], recipe)).toThrow("unavailable");
    second.occurrences[0]!.rowHash = "f".repeat(64);
    expect(() => resolveLibraryRecipe([first, second], recipe)).toThrow("conflicting-row");
  });
  it("preserves partial-scope memberships as disjoint consecutive units, including separated blocks", () => {
    const a = scope(1, 2025, 9), b = scope(2, 2025, 9), c = scope(3, 2025, 9);
    a.occurrences = [row(1), row(2)]; b.occurrences = [row(2), row(3)]; b.source.unitId = a.source.unitId;
    c.occurrences = [row(4)];
    const r: LibraryRecipe = { filters: EMPTY_LIBRARY_FILTERS, scopes: [a, c, b].map(s => ({ id: s.id, version: s.version })), excludedOccurrenceKeys: [], scopeStatus: "confirmed" };
    const units = planLibraryUnits([a, b, c], r);
    expect(units.map(u => u.occurrenceKeys)).toEqual([[row(1).key], [row(2).key], [row(4).key], [row(3).key]]);
    expect(units.filter(u => u.scopeIds.includes(b.id)).flatMap(u => u.occurrenceKeys)).toEqual([row(2).key, row(3).key]);
    b.classification.school = "다른 사용 학교";
    expect(planLibraryUnits([a, b, c], r)).toHaveLength(4);
    b.classification.exam!.questionNumbers = [43, 44, 45];
    expect(() => planLibraryUnits([a, b, c], r)).toThrow("conflicting-classification");
  });
});
