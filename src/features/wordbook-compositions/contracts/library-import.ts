import { z } from "zod";
import { libraryClassificationSchema, libraryHashSchema } from "./library";

/** Service-only, reviewed export. Original source files are kept outside the app repository. */
export const libraryImportSchema = z.object({
  schemaVersion: z.literal("vocabulary-library-import-v1"),
  sourceCatalogHash: libraryHashSchema, linksHash: libraryHashSchema, referenceCatalogHash: libraryHashSchema,
  scopes: z.array(z.object({
    key: z.string().trim().min(1).max(200), name: z.string().trim().min(1).max(240),
    sourceTitle: z.string().trim().min(1).max(240),
    source: z.object({
      datasetId: z.uuid(), unitId: z.uuid(), kind: z.enum(["legacy_vocab", "exam_use", "reviewed_exam"]),
      releaseId: z.uuid().nullable(), releaseVersion: libraryHashSchema,
      fileHash: libraryHashSchema, locator: z.string().trim().min(1).max(240),
    }).strict().refine(s => (s.kind === "legacy_vocab") === (s.releaseId === null)),
    classification: libraryClassificationSchema,
    rows: z.array(z.object({
      sourceRow: z.number().int().positive(), rowHash: libraryHashSchema,
      resources: z.object({
        entryHash: libraryHashSchema.nullable(),
        linkRecordHash: libraryHashSchema,
        // Selected values and their source references are preserved together.
        selected: z.record(z.string(), z.unknown()),
      }).strict(),
    }).strict()).min(1).max(20000).refine(rows => new Set(rows.map(r => r.sourceRow)).size === rows.length),
  }).strict()).min(1).max(5000).refine(scopes => new Set(scopes.map(s => s.key)).size === scopes.length),
}).strict();
export type LibraryImport = z.infer<typeof libraryImportSchema>;
