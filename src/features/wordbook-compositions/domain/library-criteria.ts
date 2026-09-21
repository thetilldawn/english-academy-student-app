import { EMPTY_LIBRARY_FILTERS, type LibraryRecipe } from "../contracts/library";
import { libraryCriteriaSchema, type LibraryCriteria, type LibraryCriteriaGroup, type LibraryScopeHeader } from "../contracts/library-query";
import { kindFilters, type LibraryKind } from "./library-editor";

export const emptyLibraryCriteria = (): LibraryCriteria => ({ groups: [], excludedOccurrenceKeys: [], scopeStatus: "confirmed" });
export const newCriteriaGroup = (kind: LibraryKind, id: string): LibraryCriteriaGroup => ({ id, kind, datasetId: null, mode: "filter", filters: kindFilters(kind), scopes: [], excludedScopeKeys: [] });
/** A legacy snapshot is exact. Its correlations cannot be reconstructed as filters. */
export function fixedLibraryCriteria(recipe: LibraryRecipe): LibraryCriteria {
  return { scopeStatus: recipe.scopeStatus, excludedOccurrenceKeys: [...recipe.excludedOccurrenceKeys], groups: recipe.scopes.length
    ? [{ id: "saved-fixed", kind: "unclassified", datasetId: null, mode: "fixed", filters: { ...EMPTY_LIBRARY_FILTERS, kinds: ["unclassified"] }, scopes: [...recipe.scopes], excludedScopeKeys: [] }] : [] };
}
export function toggleCriteriaScope(group: LibraryCriteriaGroup, scope: LibraryScopeHeader, include: boolean): LibraryCriteriaGroup {
  if (scope.availability !== "available" && include) return group;
  if (group.mode === "fixed") return { ...group, scopes: include ? [...group.scopes.filter(r => r.id !== scope.id), { id: scope.id, version: scope.version }] : group.scopes.filter(r => r.id !== scope.id) };
  return { ...group, excludedScopeKeys: include ? group.excludedScopeKeys.filter(k => k !== scope.scopeKey) : [...new Set([...group.excludedScopeKeys, scope.scopeKey])] };
}
export const validLibraryCriteria = (criteria: LibraryCriteria) => libraryCriteriaSchema.safeParse(criteria).success;
