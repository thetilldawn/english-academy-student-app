import { z } from "zod";
import { quizContentModes } from "@/lib/quiz/question-content-mode";
import { displayAtomSchema, sharedPronunciationSchema } from "@/lib/quiz/shared-display";

export const LOCAL_QUIZ_PROTOCOL = "local_batch_v1" as const;
export const COMMON_QUIZ_FRESH_MS = 48 * 60 * 60 * 1000;
const uuid = z.uuid();
const digest = z.string().regex(/^[a-f0-9]{64}$/);
const milliseconds = z.number().int().nonnegative().max(9_999_999_999_999);
const choice = z.number().int().min(0).max(3);
export const localPhaseSchema = z.enum(["initial", "retry"]);
const pronunciation = sharedPronunciationSchema;
// Shared bodies contain no student, answer, attempt, ordering or grading value.
export const commonQuizBodySchema = z.object({
  contentId: uuid, quizContentMode: z.enum(quizContentModes), direction: z.enum(["english_to_korean", "korean_to_english"]),
  prompt: z.string(), choices: z.array(z.string()).length(4), pronunciation, choicePronunciations: z.array(pronunciation).length(4),
}).strict();
export const commonQuizContentSchema = z.object({ key: z.string().regex(/^[0-9a-f-]{36}:[a-f0-9]{64}$/), body: commonQuizBodySchema }).strict();
export const commonQuizReferenceSchema = z.object({ key: z.string(), contentId: uuid, quizContentMode: z.enum(quizContentModes),
  direction: z.enum(["english_to_korean", "korean_to_english"]), prompt: z.string(), choices: z.array(z.string()).length(4),
  pronunciation: z.string(), choicePronunciations: z.array(z.string()).length(4) }).strict();
export const commonQuizPacketSchema = z.object({ contents: z.array(commonQuizReferenceSchema).max(500), atoms: z.array(displayAtomSchema).max(5000) }).strict();
export const localPlanItemSchema = z.object({ id: uuid, order: z.number().int().positive(), contentId: uuid, correctChoiceIndex: choice,
  priorWrongCount: z.number().int().nonnegative() });
export const localPhasePlanSchema = z.object({ protocol: z.literal(LOCAL_QUIZ_PROTOCOL), attemptId: uuid, phase: localPhaseSchema,
  planHash: digest, startedAt: z.iso.datetime({ offset: true }), serverNow: z.iso.datetime({ offset: true }),
  limitMs: milliseconds.nullable(), questionLimitMs: z.number().int().min(5000).max(600000).nullable(),
  timePolicy: z.literal("local-elapsed-v1"), items: z.array(localPlanItemSchema).min(1).max(500),
  status: z.enum(["in_progress", "completed", "expired"]), officialPhase: z.enum(["initial", "review", "retry", "completed"]),
});
export const localQuizPreparationSchema = z.object({ protocol: z.literal(LOCAL_QUIZ_PROTOCOL), studentId: uuid, assignmentId: uuid,
  preparationId: uuid, planHash: digest, title: z.string(), quizContentMode: z.enum(quizContentModes),
  timingMode: z.enum(["none", "total", "per_question"]), questionTimeLimitSeconds: z.number().int().positive().nullable(),
  items: z.array(z.object({ contentId: uuid, key: z.string() })).min(1).max(500), packet: commonQuizPacketSchema,
});
export const localAnswerSchema = z.object({ id: uuid, order: z.number().int().positive(), kind: z.enum(["answer", "timeout", "unanswered"]),
  choice: choice.nullable(), elapsedMs: milliseconds, openedMs: milliseconds }).strict();
export const localBatchSchema = z.object({ submissionId: uuid, attemptId: uuid, phase: localPhaseSchema, planHash: digest,
  answers: z.array(localAnswerSchema).min(1).max(500), completion: z.object({ elapsedMs: milliseconds, reason: z.enum(["answered", "deadline"]) }).strict() }).strict();
export const localReceiptSchema = z.object({ protocol: z.literal(LOCAL_QUIZ_PROTOCOL), submissionId: uuid, phase: localPhaseSchema, planHash: digest,
  payloadHash: digest, accepted: z.array(z.object({ id: uuid, answerHash: digest, sequence: z.number().int().positive() })).min(1).max(500),
  result: z.object({ state: z.string(), finalized: z.boolean() }).passthrough(), retryTargets: z.array(uuid).max(500) });
const device = z.string().regex(/^[a-f0-9]{64}$/);
export const localQuizRequestSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("study"), assignmentId: uuid, knownKeys: z.array(z.string().max(110)).max(5500) }).strict(),
  z.object({ action: z.literal("prefetch"), assignmentId: uuid, knownKeys: z.array(z.string().max(110)).max(5500), includeRefs: z.boolean().optional() }).strict(),
  z.object({ action: z.literal("prepare"), assignmentId: uuid, device, knownKeys: z.array(z.string().max(110)).max(5500) }).strict(),
  z.object({ action: z.literal("begin"), preparationId: uuid, planHash: digest, device }).strict(),
  z.object({ action: z.literal("retry"), attemptId: uuid, device }).strict(),
  z.object({ action: z.literal("read"), attemptId: uuid, phase: localPhaseSchema, device }).strict(),
  z.object({ action: z.literal("submit"), device, batch: localBatchSchema }).strict(),
  z.object({ action: z.literal("identity") }).strict(),
]);
export type CommonQuizBody = z.infer<typeof commonQuizBodySchema>;
export type CommonQuizContent = z.infer<typeof commonQuizContentSchema>;
export type CommonQuizReference = z.infer<typeof commonQuizReferenceSchema>;
export type CommonQuizPacket = z.infer<typeof commonQuizPacketSchema>;
export type LocalQuizPreparation = z.infer<typeof localQuizPreparationSchema>;
export type LocalPhasePlan = z.infer<typeof localPhasePlanSchema>;
export type LocalAnswer = z.infer<typeof localAnswerSchema>;
export type LocalBatch = z.infer<typeof localBatchSchema>;
export type LocalReceipt = z.infer<typeof localReceiptSchema>;
export type LocalQuizRequest = z.infer<typeof localQuizRequestSchema>;

export type LocalQuizRun = {
  key: string; revision: number; identity: string; studentId: string; device: string;
  preparation: Omit<LocalQuizPreparation, "packet">;
  plan: LocalPhasePlan | null; startRequested: boolean; answers: LocalAnswer[]; openedMs: number;
  clock: { wallAt: number; elapsedAt: number }; batch: LocalBatch | null; receipt: LocalReceipt | null;
};
