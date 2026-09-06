import { z } from "zod";

import { studentDirectoryStatuses, studentDirectoryWrongFilters } from "./student-directory-read-model";

export const directoryFiltersSchema = z.object({
  classGroupId: z.union([z.literal(""), z.uuid()]), grade: z.string().max(40),
  query: z.string().max(80), school: z.string().max(120),
  status: z.enum(studentDirectoryStatuses), wordbook: z.string().max(160),
  wrong: z.enum(studentDirectoryWrongFilters),
});
export const directoryIntegerSchema = z.union([z.number(), z.string().regex(/^-?\d+$/u).transform(Number)])
  .pipe(z.number().int().min(Number.MIN_SAFE_INTEGER).max(Number.MAX_SAFE_INTEGER));
const nonnegativeInteger = directoryIntegerSchema.refine(value => value >= 0);
export const studentDirectoryListItemSchema = z.object({
  codeStatus: z.enum(["active", "blocked", "expired", "missing"]),
  completedCount: nonnegativeInteger, currentVocabBook: z.string().nullable(),
  displayName: z.string().min(1), gradeLabel: z.string().nullable(), id: z.uuid(),
  missedCount: nonnegativeInteger, notStartedCount: nonnegativeInteger,
  rawPoints: directoryIntegerSchema, recentExamAt: z.iso.datetime({ offset: true }).nullable(),
  schoolName: z.string().nullable(), status: z.enum(["active", "blocked"]),
});
export const studentDirectoryFilterOptionsSchema = z.object({
  classGroups: z.array(z.object({ id: z.uuid(), name: z.string().min(1) })),
  grades: z.array(z.string()), schools: z.array(z.string()), wordbooks: z.array(z.string()),
});
export const directorySnapshotSchema = z.object({
  filterOptions: studentDirectoryFilterOptionsSchema, filters: directoryFiltersSchema,
  page: z.object({ items: z.array(studentDirectoryListItemSchema).max(10), nextCursor: z.string().nullable() }),
  snapshotAt: z.iso.datetime({ offset: true }), totalCount: nonnegativeInteger,
}).refine(value => value.totalCount >= value.page.items.length);
const identitySchema = z.string().regex(/^[a-f0-9]{64}$/u);
export const directoryCacheRequestSchema = z.object({
  mode: z.literal("cache"), filters: directoryFiltersSchema,
  identity: identitySchema.optional(),
  studentIds: z.array(z.uuid()).max(10).refine(ids => new Set(ids).size === ids.length).optional(),
});
export const directoryCacheResponseSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("snapshot"), identity: identitySchema.nullable(), userId: z.uuid(), snapshot: directorySnapshotSchema }),
  z.object({ kind: z.literal("resume"), identity: identitySchema, userId: z.uuid(), points: z.array(z.object({ id: z.uuid(), rawPoints: directoryIntegerSchema })).max(10) }),
]);
export type DirectoryCacheRequest = z.infer<typeof directoryCacheRequestSchema>;
export type DirectoryCacheResponse = z.infer<typeof directoryCacheResponseSchema>;

export class StudentDirectoryRequestError extends Error {
  constructor(readonly status: number) {
    super(status === 401 || status === 403 ? "로그인을 다시 확인해 주세요." : "학생 목록을 불러오지 못했습니다. 다시 불러와 주세요.");
    this.name = "StudentDirectoryRequestError";
  }
}
