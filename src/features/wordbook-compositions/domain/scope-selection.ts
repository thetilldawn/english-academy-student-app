import type { MockScopeMetadata, SourceScope } from "../contracts/composition";

export type ScopeFilters = {
  years: readonly number[]; months: readonly number[]; types: readonly string[];
  yearFrom?: number | null; yearTo?: number | null; questions?: readonly number[]; examKinds?: readonly ("mock" | "csat")[];
};
export const EMPTY_SCOPE_FILTERS: ScopeFilters = { years: [], months: [], types: [] };
export function matchesScope(scope: MockScopeMetadata, filters: ScopeFilters) {
  return (!filters.years.length || filters.years.includes(scope.executionYear)) &&
    (filters.yearFrom == null || scope.executionYear >= filters.yearFrom) &&
    (filters.yearTo == null || scope.executionYear <= filters.yearTo) &&
    (!filters.questions?.length || scope.questionNumbers.some(n => filters.questions!.includes(n))) &&
    (!filters.examKinds?.length || filters.examKinds.includes(scope.examKind)) &&
    (!filters.months.length || filters.months.includes(scope.examMonth)) &&
    (!filters.types.length || filters.types.includes(scope.typeCode));
}
export function toggleFilterValue<T extends string | number>(values: readonly T[], value: T): T[] {
  return values.includes(value) ? values.filter(v => v !== value) : [...values, value];
}
export function changeVisibleSelection(selected: readonly string[], visible: readonly string[], include: boolean) {
  const visibleSet = new Set(visible);
  return include ? [...new Set([...selected, ...visible])] : selected.filter(id => !visibleSet.has(id));
}
export function summarizeScopeSelection(scopes: readonly SourceScope[], selected: readonly string[]) {
  const ids = new Set(selected);
  const selectedScopes = scopes.filter(scope => ids.has(scope.id));
  return { scopes: selectedScopes, scopeCount: selectedScopes.length,
    sourceEntryCount: selectedScopes.reduce((n, s) => n + s.sourceEntryCount, 0),
    includedEntryCount: selectedScopes.reduce((n, s) => n + s.includedEntryCount, 0) };
}
