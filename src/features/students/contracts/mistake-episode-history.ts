import { z } from "zod";

export const mistakeSequenceSchema = z.string().regex(/^\d{1,19}$/)
  .refine(value => BigInt(value) <= BigInt("9223372036854775807"));
const timestamp = z.iso.datetime({ offset: true });
const meaningKey = z.string().regex(/^[a-f0-9]{64}$/);
export const mistakeEpisodeSchema = z.object({
  episodeId: z.uuid(), openedAt: timestamp, resolvedAt: timestamp.nullable(),
  wrongCount: z.number().int().nonnegative(), missedCount: z.number().int().nonnegative(), includesLegacy: z.boolean(),
});
export const mistakeEpisodeCursorSchema = z.object({
  schemaVersion: z.literal("vocabulary-mistake-episode-cursor-v1"), studentId: z.uuid(), meaningKey,
  stateVersion: mistakeSequenceSchema, lastSequence: mistakeSequenceSchema, openedAt: timestamp, episodeId: z.uuid(),
}).strict().refine(value => BigInt(value.lastSequence) <= BigInt(value.stateVersion));
export const mistakeEpisodeHistoryInputSchema = z.object({
  meaningKey, upperVersion: mistakeSequenceSchema, cursor: z.string().regex(/^[A-Za-z0-9_-]{1,3000}$/).optional(),
}).strict();
export const mistakeEpisodeHistoryPageSchema = z.object({
  meaningKey, stateVersion: mistakeSequenceSchema, episodeCount: z.number().int().nonnegative(),
  items: z.array(mistakeEpisodeSchema).max(20), nextCursor: z.string().regex(/^[A-Za-z0-9_-]{1,3000}$/).nullable(),
});
export type MistakeEpisode = z.infer<typeof mistakeEpisodeSchema>;
export type MistakeEpisodeHistoryInput = z.infer<typeof mistakeEpisodeHistoryInputSchema>;
export type MistakeEpisodeHistoryPage = z.infer<typeof mistakeEpisodeHistoryPageSchema>;
export type MistakeEpisodeHistoryReader = { kind: "student"; identity: string } | { kind: "admin"; studentId: string };

export function mistakeEpisodeHistorySearch(params: URLSearchParams) {
  if ([...params.keys()].some(key => !["meaningKey", "upperVersion", "cursor"].includes(key) || params.getAll(key).length !== 1)) return null;
  const parsed = mistakeEpisodeHistoryInputSchema.safeParse(Object.fromEntries(params));
  return parsed.success ? parsed.data : null;
}
