import { z } from "zod";
import { awaitWithAbortSignal, createRequestDeadline } from "@/lib/network/request-policy";
import { practicePreviewSchema, type PracticeInput, type PracticeStartInput } from "../contracts/practice";
import { attemptResponseSchema } from "./quiz-attempt";

export class PracticeRequestError extends Error {
  constructor(public readonly status: number, message: string, public readonly code?: string) { super(message); }
}
async function send<T>(path: string, input: unknown, schema: z.ZodType<T>, signal?: AbortSignal): Promise<T> {
  const deadline = createRequestDeadline(20_000, signal);
  try {
    const response = await awaitWithAbortSignal(fetch(path, { method: "POST", headers: { "content-type": "application/json", "x-quiz-preparation": "1" },
      body: JSON.stringify(input), cache: "no-store", signal: deadline.signal }), deadline.signal);
    const value: unknown = await awaitWithAbortSignal(response.json(), deadline.signal);
    if (!response.ok) {
      const parsed = z.object({ error: z.string(), code: z.string().optional() }).safeParse(value);
      throw new PracticeRequestError(response.status, parsed.success ? parsed.data.error : "연습 상태를 확인하지 못했습니다.", parsed.success ? parsed.data.code : undefined);
    }
    return schema.parse(value);
  } finally { deadline.dispose(); }
}
export const requestPracticePreview = (input: PracticeInput, signal?: AbortSignal) => send("/api/student/practice/preview", input, practicePreviewSchema, signal);
export const requestPracticeStart = (input: PracticeStartInput, signal?: AbortSignal) => send("/api/student/practice", input, z.union([z.object({preparationId:z.uuid()}),attemptResponseSchema]), signal);
