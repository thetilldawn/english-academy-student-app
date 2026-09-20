export { scopeMetadataSchema } from "./contracts/composition";
export type { CreatedComposition, MockScopeMetadata, SourceScope } from "./contracts/composition";
export { EMPTY_SCOPE_FILTERS, matchesScope, changeVisibleSelection } from "./domain/scope-selection";
export type { ScopeFilters } from "./domain/scope-selection";
export { EMPTY_LIBRARY_FILTERS } from "./contracts/library";
export type { LibraryScope, LibraryTemplate, LibraryVersion, LibraryFilters, LibraryClassification } from "./contracts/library";
export type { CreatedLibraryBook } from "./contracts/library";
export { frozenQuestionPronunciationSchema, frozenPronunciationSchema } from "./contracts/library-resources";
