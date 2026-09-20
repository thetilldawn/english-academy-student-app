import { libraryFiltersSchema, type LibraryFilters, type LibraryRecipe, type LibraryScope } from "../contracts/library";

const any = <T>(choices: readonly T[], value: T | null) => !choices.length || value !== null && choices.includes(value);
const inRange = (value: number | null, from: number | null, to: number | null) =>
  from === null && to === null || value !== null && (from === null || value >= from) && (to === null || value <= to);

export function matchesLibraryScope(scope: LibraryScope, filters: LibraryFilters) {
  if (!libraryFiltersSchema.safeParse(filters).success) return false;
  const c = scope.classification;
  const q = filters.search.trim().toLocaleLowerCase("ko-KR");
  const text = [scope.name, scope.sourceTitle, c.publisher, c.school, c.assessment, c.purpose, c.exam?.typeLabel]
    .filter(Boolean).join(" ").toLocaleLowerCase("ko-KR");
  return (!q || q.split(/\s+/).every(term => text.includes(term))) &&
    any(filters.kinds, c.kind) && any(filters.years, c.exam?.executionYear ?? null) &&
    inRange(c.exam?.executionYear ?? null, filters.yearFrom, filters.yearTo) &&
    any(filters.months, c.exam?.examMonth ?? null) && any(filters.types, c.exam?.typeCode ?? null) &&
    (!filters.questions.length || c.exam?.questionNumbers.some(n => filters.questions.includes(n)) === true) &&
    any(filters.sourceGrades, c.sourceGrade) && inRange(c.day, filters.dayFrom, filters.dayTo) &&
    any(filters.lessons, c.lesson) && any(filters.schools, c.school) && any(filters.targetGrades, c.targetGrade) &&
    any(filters.semesters, c.semester) && any(filters.assessments, c.assessment) && any(filters.purposes, c.purpose);
}

export class LibrarySelectionError extends Error {
  constructor(readonly reason: "missing" | "changed" | "unavailable" | "conflicting-row" | "conflicting-classification" | "invalid-exclusion" | "size") {
    super(reason);
  }
}

/** Usage tags can differ; a source passage cannot acquire a different exam identity. */
export function sourceClassification(scope: LibraryScope) {
  const c = scope.classification;
  return { kind: c.kind, sourceGrade: c.sourceGrade, exam: c.exam, lesson: c.lesson, day: c.day, publisher: c.publisher };
}

/** Identity is a source occurrence, never a headword or merely an exam number. */
export function resolveLibraryRecipe(catalog: readonly LibraryScope[], recipe: LibraryRecipe) {
  const byId = new Map(catalog.map(s => [s.id, s]));
  const rows = new Map<string, LibraryScope["occurrences"][number]>();
  const rowScopes = new Map<string, string[]>();
  const rowClassification = new Map<string, string>();
  const scopes: LibraryScope[] = [];
  for (const selected of recipe.scopes) {
    const scope = byId.get(selected.id);
    if (!scope) throw new LibrarySelectionError("missing");
    if (scope.version !== selected.version) throw new LibrarySelectionError("changed");
    if (scope.availability !== "available") throw new LibrarySelectionError("unavailable");
    scopes.push(scope);
    for (const row of scope.occurrences) {
      const classification = JSON.stringify(sourceClassification(scope));
      if (rowClassification.has(row.key) && rowClassification.get(row.key) !== classification) throw new LibrarySelectionError("conflicting-classification");
      rowClassification.set(row.key, classification);
      const previous = rows.get(row.key);
      if (previous && (previous.sourceEntryId !== row.sourceEntryId || previous.rowHash !== row.rowHash ||
        previous.state !== row.state || previous.sourceRow !== row.sourceRow)) throw new LibrarySelectionError("conflicting-row");
      rows.set(row.key, row);
      rowScopes.set(row.key, [...(rowScopes.get(row.key) ?? []), scope.id]);
    }
  }
  if (rows.size > 20000) throw new LibrarySelectionError("size");
  const exclusions = new Set(recipe.excludedOccurrenceKeys);
  for (const key of exclusions) if (!rows.has(key)) throw new LibrarySelectionError("invalid-exclusion");
  const occurrences = [...rows.values()];
  const included = occurrences.filter(r => r.state === "included" && !exclusions.has(r.key));
  return { scopes, occurrences, included, rowScopes,
    sourceCount: occurrences.length, includedCount: included.length,
    heldCount: occurrences.filter(r => r.state === "held").length,
    excludedCount: occurrences.length - included.length - occurrences.filter(r => r.state === "held").length,
  };
}

/** Disjoint consecutive blocks keep both source-scope membership and occurrence order. */
export function planLibraryUnits(catalog: readonly LibraryScope[], recipe: LibraryRecipe) {
  const selection = resolveLibraryRecipe(catalog, recipe);
  const scopes = new Map(selection.scopes.map(s => [s.id, s]));
  const units: { name: string; scopeIds: string[]; occurrenceKeys: string[]; classification: ReturnType<typeof sourceClassification>; sourceUnitId: string }[] = [];
  let previousKey: string | null = null;
  for (const row of selection.included) {
    const scopeIds = selection.rowScopes.get(row.key)!;
    const first = scopes.get(scopeIds[0]!)!;
    const classification = sourceClassification(first);
    const key = JSON.stringify([first.source.datasetId, first.source.kind, first.source.releaseId, first.source.releaseVersion,
      first.source.fileHash, first.source.unitId, classification, [...scopeIds].sort()]);
    if (key === previousKey) units.at(-1)!.occurrenceKeys.push(row.key);
    else {
      units.push({ name: scopeIds.length > 1 ? `${first.name.slice(0, 120)} 외 ${scopeIds.length - 1}개 범위의 공통 부분` : first.name,
        scopeIds: [...scopeIds], occurrenceKeys: [row.key], classification, sourceUnitId: first.source.unitId });
      previousKey = key;
    }
  }
  return units;
}
