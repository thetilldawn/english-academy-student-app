import { z } from "zod";
import { scopeMetadataSchema } from "./composition";

export const libraryHashSchema = z.string().regex(/^[a-f0-9]{64}$/);
const label = z.string().trim().min(1).max(240);
const grade = z.string().trim().min(1).max(40).nullable();
const year = z.number().int().min(2000).max(2100);
const unique = <T>(values: T[]) => new Set(values).size === values.length;

export const libraryClassificationSchema = z.object({
  kind: z.enum(["textbook", "wordbook", "mock", "csat", "school", "unclassified"]),
  sourceGrade: grade,
  exam: scopeMetadataSchema.nullable(),
  lesson: z.number().int().min(1).max(999).nullable(),
  day: z.number().int().min(1).max(999).nullable(),
  publisher: label.nullable(),
  school: label.nullable(),
  targetGrade: grade,
  schoolYear: year.nullable(),
  semester: z.union([z.literal(1), z.literal(2)]).nullable(),
  assessment: label.nullable(),
  purpose: label.nullable(),
}).strict().refine(c => c.kind !== "mock" && c.kind !== "csat" || c.exam?.examKind === c.kind,
  "시험 분류를 확인해 주세요.");

export const libraryOccurrenceSchema = z.object({
  key: libraryHashSchema,
  sourceRow: z.number().int().positive(),
  sourceEntryId: z.number().int().positive().safe().nullable(),
  rowHash: libraryHashSchema,
  state: z.enum(["included", "held", "excluded"]),
  headword: z.string().nullable().optional(), meaning: z.string().nullable().optional(),
}).strict().refine(r => r.state !== "included" || r.sourceEntryId !== null);

export const libraryScopeSchema = z.object({
  id: z.uuid(), version: libraryHashSchema, name: label, sourceTitle: label,
  source: z.object({
    datasetId: z.uuid(), unitId: z.uuid(),
    kind: z.enum(["legacy_vocab", "exam_use", "reviewed_exam"]),
    releaseId: z.uuid().nullable(), releaseVersion: libraryHashSchema,
    fileHash: libraryHashSchema, locator: label,
  }).strict().refine(s => (s.kind === "legacy_vocab") === (s.releaseId === null)),
  classification: libraryClassificationSchema,
  availability: z.enum(["available", "retired", "changed"]),
  occurrences: z.array(libraryOccurrenceSchema).min(1).max(20000).refine(r => unique(r.map(x => x.key))),
}).strict();
export type LibraryScope = z.infer<typeof libraryScopeSchema>;
export type LibraryClassification = z.infer<typeof libraryClassificationSchema>;

export const libraryFiltersSchema = z.object({
  search: z.string().max(240),
  kinds: z.array(libraryClassificationSchema.shape.kind).max(6).refine(unique),
  years: z.array(year).max(101).refine(unique),
  yearFrom: year.nullable(), yearTo: year.nullable(),
  months: z.array(z.number().int().min(1).max(12)).max(12).refine(unique),
  types: z.array(z.string().min(1).max(80)).max(100).refine(unique),
  questions: z.array(z.number().int().min(1).max(45)).max(45).refine(unique),
  sourceGrades: z.array(z.string().min(1).max(40)).max(20).refine(unique),
  dayFrom: z.number().int().min(1).max(999).nullable(),
  dayTo: z.number().int().min(1).max(999).nullable(),
  lessons: z.array(z.number().int().min(1).max(999)).max(100).refine(unique),
  schools: z.array(label).max(100).refine(unique),
  targetGrades: z.array(z.string().min(1).max(40)).max(20).refine(unique),
  semesters: z.array(z.union([z.literal(1), z.literal(2)])).max(2).refine(unique),
  assessments: z.array(label).max(50).refine(unique),
  purposes: z.array(label).max(50).refine(unique),
}).strict().refine(f => f.yearFrom === null || f.yearTo === null || f.yearFrom <= f.yearTo,
  "시작 연도가 끝 연도보다 늦습니다.")
  .refine(f => f.dayFrom === null || f.dayTo === null || f.dayFrom <= f.dayTo, "DAY 구간을 확인해 주세요.");
export type LibraryFilters = z.infer<typeof libraryFiltersSchema>;
export const EMPTY_LIBRARY_FILTERS: LibraryFilters = {
  search: "", kinds: [], years: [], yearFrom: null, yearTo: null, months: [], types: [], questions: [],
  sourceGrades: [], dayFrom: null, dayTo: null, lessons: [], schools: [], targetGrades: [],
  semesters: [], assessments: [], purposes: [],
};

export const templateMetadataSchema = z.object({
  title: z.string().trim().min(1).max(100),
  tags: z.array(z.string().trim().min(1).max(40)).max(30).refine(unique),
  school: label.nullable(), targetGrade: grade, schoolYear: year.nullable(),
  semester: z.union([z.literal(1), z.literal(2)]).nullable(),
  assessment: label.nullable(), purpose: label.nullable(),
}).strict();
export type TemplateMetadata = z.infer<typeof templateMetadataSchema>;
export const libraryRecipeSchema = z.object({
  filters: libraryFiltersSchema,
  scopes: z.array(z.object({ id: z.uuid(), version: libraryHashSchema }).strict()).max(2000)
    .refine(s => unique(s.map(x => x.id))),
  excludedOccurrenceKeys: z.array(libraryHashSchema).max(20000).refine(unique),
  scopeStatus: z.enum(["confirmed", "unconfirmed"]),
}).strict().refine(r => r.scopeStatus !== "unconfirmed" || r.scopes.length === 0,
  "미확정 틀에는 시험 범위를 확정해 넣을 수 없습니다.");
export type LibraryRecipe = z.infer<typeof libraryRecipeSchema>;

export const libraryVersionSchema = z.object({
  id: z.uuid(), number: z.number().int().positive(), contentHash: libraryHashSchema,
  recipe: libraryRecipeSchema,
  includedKeys: z.array(libraryHashSchema).max(20000).refine(unique),
  sourceCount: z.number().int().min(0).max(20000),
  sourceVersionId: z.uuid().nullable(),
  datasetId: z.uuid().nullable(),
  createdAt: z.iso.datetime({ offset: true }),
}).strict();
export const libraryTemplateSchema = z.object({
  id: z.uuid(), revision: z.number().int().positive(), metadata: templateMetadataSchema,
  versions: z.array(libraryVersionSchema).min(1).max(1000),
}).strict().refine(t => unique(t.versions.map(v => v.id)) && unique(t.versions.map(v => v.number)));
export type LibraryTemplate = z.infer<typeof libraryTemplateSchema>;
export type LibraryVersion = z.infer<typeof libraryVersionSchema>;

export const libraryCatalogSchema = z.object({
  viewerId: z.uuid(),
  scopes: z.array(libraryScopeSchema).max(5000), templates: z.array(libraryTemplateSchema).max(5000),
}).strict().refine(c => unique(c.scopes.map(s => s.id)) && unique(c.templates.map(t => t.id)));
export type LibraryCatalog = z.infer<typeof libraryCatalogSchema>;

const requestId = z.uuid();
const expected = { templateId: z.uuid(), expectedRevision: z.number().int().positive() };
export const libraryCommandSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("create"), requestId, metadata: templateMetadataSchema, recipe: libraryRecipeSchema }).strict(),
  z.object({ action: z.literal("metadata"), requestId, ...expected, metadata: templateMetadataSchema }).strict(),
  z.object({ action: z.literal("version"), requestId, ...expected, expectedContentHash: libraryHashSchema, recipe: libraryRecipeSchema }).strict(),
  z.object({ action: z.literal("copy"), requestId, sourceVersionId: z.uuid(), metadata: templateMetadataSchema }).strict(),
  z.object({ action: z.literal("materialize"), requestId, templateId: z.uuid(), versionId: z.uuid(), contentHash: libraryHashSchema }).strict(),
]);
export type LibraryCommand = z.infer<typeof libraryCommandSchema>;
export const createdLibraryBookSchema = z.object({
  versionId: z.uuid(), contentHash: libraryHashSchema,
  dataset: z.object({
    id: z.uuid(), title: label, displayName: label, edition: z.string().nullable(), catalogGroup: z.enum(["middle", "high", "high_mock", "csat"]),
    materialKind: z.literal("wordbook"), gradeCode: z.string().nullable(), publisher: z.string().nullable(), seriesTitle: z.string().nullable(),
    academicYear: year.nullable(), curriculumRevision: z.string().nullable(), editionLabel: z.string().nullable(),
    isAssignable: z.boolean(), catalogSortIndex: z.number().int().nonnegative(), schoolName: z.string().nullable(),
    schoolClassification: z.enum(["school", "common", "unclassified"]), purpose: z.literal("exam_prep").nullable(), semester: z.union([z.literal(1), z.literal(2)]).nullable(),
    isActive: z.boolean(), rowCount: z.number().int().nonnegative(), status: z.enum(["ready", "retired", "pending_review"]), questionBankKind: z.literal("vocabulary_composition_v1"),
    availableQuestionModes: z.array(z.enum(["book_meaning_choice", "canonical_definition_to_headword", "canonical_headword_to_definition"])).max(3),
  }).strict(),
}).strict();
export type CreatedLibraryBook = z.infer<typeof createdLibraryBookSchema>;
export const libraryCommandResultSchema = z.object({ template: libraryTemplateSchema, createdBook: createdLibraryBookSchema.optional() }).strict();
