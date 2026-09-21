import { z } from "zod";
import { libraryClassificationSchema, libraryFiltersSchema, libraryHashSchema, libraryRecipeSchema, libraryScopeSchema, templateMetadataSchema } from "./library";

const refs = libraryRecipeSchema.shape.scopes;
const kind = libraryClassificationSchema.shape.kind;
const unique = (values: string[]) => new Set(values).size === values.length;
export const libraryCriteriaGroupSchema = z.object({
  id: z.string().min(1).max(80), kind, datasetId: z.uuid().nullable(),
  mode: z.enum(["filter", "fixed"]), filters: libraryFiltersSchema, scopes: refs,
  excludedScopeKeys: z.array(z.string().min(1).max(1000)).max(2000).refine(unique),
}).strict().superRefine((g, ctx) => {
  if (g.mode === "filter" && (g.scopes.length || g.filters.kinds.length !== 1 || g.filters.kinds[0] !== g.kind))
    ctx.addIssue({ code: "custom", message: "자료 종류에 맞는 조건을 확인해 주세요." });
  if (g.mode === "fixed" && g.excludedScopeKeys.length)
    ctx.addIssue({ code: "custom", message: "고정 범위의 선택을 확인해 주세요." });
});
export const libraryCriteriaSchema = z.object({
  groups: z.array(libraryCriteriaGroupSchema).max(100).refine(g => unique(g.map(x => x.id))),
  excludedOccurrenceKeys: libraryRecipeSchema.shape.excludedOccurrenceKeys,
  scopeStatus: z.enum(["confirmed", "unconfirmed"]),
}).strict().refine(c => c.scopeStatus !== "unconfirmed" || !c.groups.length && !c.excludedOccurrenceKeys.length);
export type LibraryCriteria = z.infer<typeof libraryCriteriaSchema>;
export type LibraryCriteriaGroup = z.infer<typeof libraryCriteriaGroupSchema>;
export const libraryVersionSummarySchema = z.object({
  id: z.uuid(), number: z.number().int().positive(), contentHash: libraryHashSchema,
  scopeStatus: z.enum(["confirmed", "unconfirmed"]), scopeCount: z.number().int().nonnegative(),
  sourceCount: z.number().int().nonnegative(), includedCount: z.number().int().nonnegative(),
  sourceVersionId: z.uuid().nullable(), datasetId: z.uuid().nullable(),
  createdAt: z.iso.datetime({ offset: true }), hasCriteria: z.boolean(),
}).strict();
export const libraryTemplateSummarySchema = z.object({
  id: z.uuid(), revision: z.number().int().positive(), metadata: templateMetadataSchema,
  latestVersion: libraryVersionSummarySchema,
}).strict();
export const libraryScopeHeaderSchema = libraryScopeSchema.omit({ occurrences: true }).extend({
  scopeKey: z.string().min(1).max(1000),
  sourceCount: z.number().int().nonnegative(), includedCount: z.number().int().nonnegative(), heldCount: z.number().int().nonnegative(),
}).strict();
export type LibraryScopeHeader = z.infer<typeof libraryScopeHeaderSchema>;
export type LibraryTemplateSummary = z.infer<typeof libraryTemplateSummarySchema>;
export type LibraryVersionSummary = z.infer<typeof libraryVersionSummarySchema>;
export const libraryCursorSchema = z.object({ binding: libraryHashSchema, snapshot: z.number().int().nonnegative().safe(), after: z.string().max(5000) }).strict();
const page = { cursor: libraryCursorSchema.nullable().default(null), limit: z.number().int().min(1).max(50).default(20) };
const selection = z.discriminatedUnion("mode", [
  z.object({ mode: z.literal("criteria"), criteria: libraryCriteriaSchema }).strict(),
  z.object({ mode: z.literal("recipe"), recipe: libraryRecipeSchema }).strict(),
]);
export const libraryQuerySchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("templates"), search: z.string().max(240), ...page }).strict(),
  z.object({ kind: z.literal("versions"), templateId: z.uuid(), ...page }).strict(),
  z.object({ kind: z.literal("detail"), templateId: z.uuid(), versionId: z.uuid().optional() }).strict(),
  z.object({ kind: z.literal("facets"), sourceKind: kind, datasetId: z.uuid().nullable(), bookSearch: z.string().max(240).default(""), ...page }).strict(),
  z.object({ kind: z.literal("scopes"), filters: libraryFiltersSchema, datasetId: z.uuid().nullable(), refs: refs.optional(), ...page }).strict(),
  z.object({ kind: z.literal("preview"), selection, compareVersionId: z.uuid().nullable(),
    metadata: templateMetadataSchema.extend({ title: z.string().max(100) }) }).strict(),
  z.object({ kind: z.literal("words"), selection: selection.optional(), versionId: z.uuid().optional(), contentHash: libraryHashSchema,
    search: z.string().max(240), ...page }).strict().refine(q => Boolean(q.selection) !== Boolean(q.versionId)),
]);
export type LibraryQuery = z.infer<typeof libraryQuerySchema>;
export type LibraryCursor = z.infer<typeof libraryCursorSchema>;
const viewerId = z.uuid(), nextCursor = libraryCursorSchema.nullable();
const option = z.object({ value: z.union([z.string(), z.number()]), label: z.string(), count: z.number().int().nonnegative() }).strict();
export const libraryFacetsSchema = z.object({
  books: z.array(z.object({ id: z.uuid(), title: z.string(), count: z.number().int().nonnegative() }).strict()).max(50),
  sourceGrades: z.array(option), years: z.array(option), months: z.array(option), types: z.array(option), questions: z.array(option),
  lessons: z.array(option), schools: z.array(option), targetGrades: z.array(option), semesters: z.array(option), assessments: z.array(option),
}).strict();
export type LibraryFacets = z.infer<typeof libraryFacetsSchema>;
export const libraryDetailSchema = z.object({ kind: z.literal("detail"), viewerId,
  template: libraryTemplateSummarySchema, version: libraryVersionSummarySchema, criteria: libraryCriteriaSchema.nullable(), recipe: libraryRecipeSchema,
  automaticTags: z.array(z.string()).max(30), sourceTags: z.array(z.string()).max(30),
}).strict();
export const libraryPreviewSchema = z.object({ kind: z.literal("preview"), viewerId,
  recipe: libraryRecipeSchema, contentHash: libraryHashSchema,
  sourceCount: z.number().int().nonnegative(), includedCount: z.number().int().nonnegative(), heldCount: z.number().int().nonnegative(), excludedCount: z.number().int().nonnegative(),
  groups: z.array(z.object({ id: z.string(), scopes: refs }).strict()).max(100),
  orphanedExclusions: libraryRecipeSchema.shape.excludedOccurrenceKeys,
  difference: z.object({ added: z.number().int().nonnegative(), removed: z.number().int().nonnegative(), scopeAdded: z.number().int().nonnegative(), scopeRemoved: z.number().int().nonnegative(), orderChanged: z.boolean(), changed: z.boolean() }).strict().nullable(),
  automaticTags: z.array(z.string()).max(30), suggestedTitle: z.string().max(100),
}).strict();
export type LibraryPreview = z.infer<typeof libraryPreviewSchema>;
export type LibraryDetail = z.infer<typeof libraryDetailSchema>;
export const libraryWordSchema = z.object({ key: libraryHashSchema, sourceRow: z.number().int().positive(),
  headword: z.string().nullable(), meaning: z.string().nullable(), state: z.enum(["included", "held", "excluded"]), selected: z.boolean(),
}).strict();
export const libraryQueryResultSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("templates"), viewerId, items: z.array(libraryTemplateSummarySchema).max(50), nextCursor }).strict(),
  z.object({ kind: z.literal("versions"), viewerId, items: z.array(libraryVersionSummarySchema).max(50), nextCursor }).strict(),
  libraryDetailSchema,
  z.object({ kind: z.literal("facets"), viewerId, facets: libraryFacetsSchema, nextCursor }).strict(),
  z.object({ kind: z.literal("scopes"), viewerId, items: z.array(libraryScopeHeaderSchema).max(50), nextCursor }).strict(),
  libraryPreviewSchema,
  z.object({ kind: z.literal("words"), viewerId, items: z.array(libraryWordSchema).max(50), total: z.number().int().nonnegative(), nextCursor }).strict(),
]);
export type LibraryQueryResult = z.infer<typeof libraryQueryResultSchema>;
export type LibraryQueryResultOf<K extends LibraryQuery["kind"]> = Extract<LibraryQueryResult, { kind: K }>;
