import { z } from "zod";

export const scopeMetadataSchema = z.object({
  executionYear: z.number().int().min(2000).max(2100),
  examMonth: z.number().int().min(1).max(12),
  examKind: z.enum(["mock", "csat"]),
  academicYear: z.number().int().min(2000).max(2101).nullable(),
  agency: z.string().trim().min(1).max(80),
  typeCode: z.string().regex(/^[a-z0-9_]+$/).max(80),
  typeLabel: z.string().trim().min(1).max(80),
  questionNumbers: z.array(z.number().int().min(1).max(45)).min(1).max(3),
  sharedPassage: z.boolean(),
}).strict().refine(s => new Set(s.questionNumbers).size === s.questionNumbers.length &&
  s.questionNumbers.every((n, i) => i === 0 || n > s.questionNumbers[i - 1]!), "문제 번호를 확인해 주세요.")
  .refine(s => (!s.sharedPassage && s.questionNumbers.every(n => n < 41)) ||
    (s.sharedPassage && ["41,42", "43,44,45"].includes(s.questionNumbers.join(","))), "장문 지문 범위를 확인해 주세요.");

export type MockScopeMetadata = z.infer<typeof scopeMetadataSchema>;
export const sourceScopeSchema = z.object({
  id: z.uuid(),
  version: z.string().regex(/^[a-f0-9]{64}$/),
  displayName: z.string().trim().min(1).max(240),
  sourceTitle: z.string().trim().min(1).max(240),
  sourceEntryCount: z.number().int().min(1).max(20000),
  includedEntryCount: z.number().int().min(1).max(20000),
  metadata: scopeMetadataSchema,
}).strict().refine(s => s.includedEntryCount <= s.sourceEntryCount);
export type SourceScope = z.infer<typeof sourceScopeSchema>;

export const compositionCatalogSchema = z.object({ scopes: z.array(sourceScopeSchema).max(2000) }).strict()
  .refine(c => new Set(c.scopes.map(s => s.id)).size === c.scopes.length);
export const createCompositionSchema = z.object({
  requestId: z.uuid(),
  title: z.string().trim().min(1).max(100),
  scopes: z.array(z.object({ id: z.uuid(), version: z.string().regex(/^[a-f0-9]{64}$/) }).strict()).min(1).max(500),
}).strict().refine(c => new Set(c.scopes.map(s => s.id)).size === c.scopes.length, "같은 범위가 중복되었습니다.");
export type CreateCompositionInput = z.infer<typeof createCompositionSchema>;
export const createdCompositionSchema = z.object({
  datasetId: z.uuid(), title: z.string().min(1).max(100),
  scopeCount: z.number().int().min(1).max(500),
  sourceEntryCount: z.number().int().min(1).max(20000),
  includedEntryCount: z.number().int().min(1).max(20000),
}).strict();
export type CreatedComposition = z.infer<typeof createdCompositionSchema>;
