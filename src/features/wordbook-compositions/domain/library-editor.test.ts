import { describe, expect, it } from "vitest";
import { EMPTY_LIBRARY_FILTERS, libraryCommandSchema, libraryRecipeSchema, newLibraryCommandSchema, type LibraryRecipe, type LibraryScope, type TemplateMetadata } from "../contracts/library";
import { groupsRecipe, kindFilters, libraryAutomaticTags, libraryEditorErrors, libraryScopeLabel, newLibraryGroup, recalculateGroup, restoreLibraryGroups } from "./library-editor";
import { resolveLibraryRecipe } from "./library-selection";

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const meta: TemplateMetadata = { title: "가짜", tags: [], school: null, targetGrade: null, schoolYear: null, semester: null, assessment: null, purpose: null };
const recipe = (scopes: LibraryScope[]): LibraryRecipe => ({ filters: EMPTY_LIBRARY_FILTERS, scopes: scopes.map(s => ({ id: s.id, version: s.version })), excludedOccurrenceKeys: [], scopeStatus: "confirmed" });
function scope(n: number, year = 2024, month = 3, type = "topic"): LibraryScope {
  return { id: id(n), version: "a".repeat(64), name: `가짜 ${n}`, sourceTitle: `가짜 자료 ${n}`, availability: "available",
    source: { datasetId: id(100 + n), unitId: id(200 + n), kind: "exam_use", releaseId: id(300 + n), releaseVersion: "b".repeat(64), fileHash: "c".repeat(64), locator: "fake" },
    classification: { kind: "mock", sourceGrade: "g12", exam: { executionYear: year, examMonth: month, examKind: "mock", academicYear: null, agency: "fake", typeCode: type, typeLabel: type === "topic" ? "주제" : "요지", questionNumbers: [23], sharedPassage: false },
      lesson: null, day: null, publisher: null, school: null, targetGrade: null, schoolYear: null, semester: null, assessment: null, purpose: null },
    occurrences: [{ key: n.toString(16).padStart(64, "0"), sourceRow: 1, sourceEntryId: n, rowHash: "d".repeat(64), state: "included" }] };
}
describe("library source group editor", () => {
  it("does not label entirely excluded or held source ranges as included material", () => {
    const a=scope(1), b=scope(2);b.classification={...b.classification,kind:"wordbook",exam:null,day:1};
    const r=recipe([a,b]);r.excludedOccurrenceKeys=[a.occurrences[0]!.key];
    expect(libraryAutomaticTags([a,b],r,meta)).toContain("DAY 1");expect(libraryAutomaticTags([a,b],r,meta)).not.toContain("모의고사");
    a.occurrences[0]!.state="held";r.excludedOccurrenceKeys=[];expect(libraryAutomaticTags([a,b],r,meta)).not.toContain("주제");
  });
  it("does not infer a Cartesian product from two saved correlated selections", () => {
    let n = 0; const all = [2024, 2026].flatMap(y => [3, 6].flatMap(m => ["topic", "gist"].map(t => scope(++n, y, m, t))));
    const before = recipe([all[0]!, all[7]!]); before.excludedOccurrenceKeys = [all[0]!.occurrences[0]!.key];
    const groups = restoreLibraryGroups(all, before);
    expect(groups[0]!.manual).toBe(true); expect(groups[0]!.filters.types).toEqual([]);
    expect(groupsRecipe(all, groups, before)).toEqual(before);
  });
  it("preserves separated groups and the exact original order on reopen", () => {
    const a = scope(1), b = scope(2), c = scope(3, 2026);
    b.classification = { ...b.classification, kind: "textbook", exam: null, lesson: 1 };
    const before = recipe([c, b, a]), groups = restoreLibraryGroups([a, b, c], before);
    expect(groups.map(g => g.kind)).toEqual(["mock", "textbook", "mock"]);
    expect(groupsRecipe([a,b,c], groups, before).scopes).toEqual(before.scopes);
  });
  it("replaces only the edited type group and retains textbook exclusions", () => {
    const a = scope(1), b = scope(2, 2024, 3, "gist"), c = scope(3);
    c.classification = { ...c.classification, kind: "textbook", exam: null, lesson: 1 };
    const all = [a,b,c], before = recipe([a,c]); before.excludedOccurrenceKeys = [c.occurrences[0]!.key];
    const groups = restoreLibraryGroups(all, before);
    groups[0] = recalculateGroup(all, { ...groups[0]!, filters: { ...groups[0]!.filters, types: ["gist"] } });
    const after = groupsRecipe(all, groups, before);
    expect(after.scopes.map(s => s.id)).toEqual([b.id,c.id]); expect(after.excludedOccurrenceKeys).toEqual(before.excludedOccurrenceKeys);
  });
  it("retains the last valid selection and exclusions during an invalid numeric edit", () => {
    const a = scope(1), before = recipe([a]); before.excludedOccurrenceKeys = [a.occurrences[0]!.key];
    const old = restoreLibraryGroups([a], before)[0]!;
    const changed = recalculateGroup([a], { ...old, filters: { ...old.filters, yearFrom: 2026, yearTo: 2024 } });
    expect(changed.scopes).toEqual(before.scopes);
    expect(groupsRecipe([a], [changed], before).excludedOccurrenceKeys).toEqual(before.excludedOccurrenceKeys);
    expect(libraryEditorErrors(meta, before, [changed], 0, false).range).toContain("시작과 끝");
  });
  it("requires a book before using its DAY and never crosses book boundaries", () => {
    const a = scope(1), b = scope(2);
    for (const s of [a,b]) s.classification = { ...s.classification, kind: "wordbook", exam: null, day: 1 };
    let g = newLibraryGroup([a,b], "wordbook", "one"); expect(g.scopes).toEqual([]);
    g = recalculateGroup([a,b], { ...g, datasetId: a.source.datasetId }); expect(g.scopes.map(s => s.id)).toEqual([a.id]);
    expect(kindFilters("mock", { ...g.filters, dayFrom: 1, dayTo: 1, lessons: [1] })).toMatchObject({ dayFrom: null, dayTo: null, lessons: [] });
  });
  it("deduplicates scope IDs while retaining the other group when one is removed", () => {
    const a = scope(1), b = scope(2), all = [a,b], before = recipe(all);
    const first = newLibraryGroup(all,"mock","first"), second = { ...first, id: "second", scopes: recipe([b]).scopes };
    expect(groupsRecipe(all,[first,second],before).scopes).toEqual(before.scopes);
    expect(groupsRecipe(all,[second],before).scopes).toEqual(recipe([b]).scopes);
  });
  it("does not replace missing, unavailable or changed references when restoring", () => {
    const a = scope(1), before = recipe([a]); const original = structuredClone(before.scopes);
    a.availability = "changed"; a.version = "b".repeat(64);
    expect(groupsRecipe([a], restoreLibraryGroups([a],before),before).scopes).toEqual(original);
    expect(groupsRecipe([], restoreLibraryGroups([],before),before).scopes).toEqual(original);
  });
  it("uses each selected version for automatic tags and distinguishes CSAT academic and execution years", () => {
    const a=scope(1,2024), b=scope(2,2025,11,"long_reading"); b.classification.kind="csat";
    b.classification.exam={ ...b.classification.exam!, examKind:"csat", academicYear:2026, typeLabel:"장문독해", questionNumbers:[41,42], sharedPassage:true };
    expect(libraryScopeLabel(b)).toBe("2026학년도 수능 (2025년 시행) · 장문독해 [41·42번]");
    expect(libraryAutomaticTags([a,b], recipe([b]), meta)).toEqual(expect.arrayContaining(["수능","수능 2025년 시행","2026학년도 수능","장문독해"]));
    expect(libraryAutomaticTags([a,b], recipe([b]), meta)).not.toContain("11월");
    expect(libraryAutomaticTags([a,b], recipe([a]), meta)).not.toContain("장문독해");
  });
  it("separates old reads and completed request retries from new confirmed empty writes", () => {
    const command = { action:"create", requestId:id(90), metadata:meta, recipe:recipe([]) };
    expect(libraryRecipeSchema.safeParse(command.recipe).success).toBe(true);
    expect(libraryCommandSchema.safeParse(command).success).toBe(true);
    expect(newLibraryCommandSchema.safeParse(command).success).toBe(false);
    expect(newLibraryCommandSchema.safeParse({ ...command, recipe:{ ...command.recipe, scopeStatus:"unconfirmed" } }).success).toBe(true);
  });
  it("distinguishes no scopes from all words excluded and explicit scope-pending drafts", () => {
    const a=scope(1), r=recipe([a]); r.excludedOccurrenceKeys=[a.occurrences[0]!.key];
    expect(libraryEditorErrors(meta,recipe([]),[],0,false).range).toContain("종류와 범위");
    expect(libraryEditorErrors(meta,r,restoreLibraryGroups([a],r),resolveLibraryRecipe([a],r).includedCount,false).range).toContain("포함할 단어");
    expect(libraryEditorErrors(meta,{ ...recipe([]),scopeStatus:"unconfirmed" },[],0,false)).toEqual({});
  });
});
