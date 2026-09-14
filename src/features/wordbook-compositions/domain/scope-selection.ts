import type { MockScopeMetadata, SourceScope } from "../contracts/composition";

export type ScopeFilters = {
  years: readonly number[]; months: readonly number[]; types: readonly string[];
};
export const EMPTY_SCOPE_FILTERS: ScopeFilters = { years: [], months: [], types: [] };
export function matchesScope(scope: MockScopeMetadata, filters: ScopeFilters) {
  return (!filters.years.length || filters.years.includes(scope.executionYear)) &&
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
