import { z } from "zod";

export const schoolSearchRequestSchema = z.object({ query: z.string().trim().min(2).max(120) }).strict();
export const schoolSearchResponseSchema = z.object({
  items: z.array(z.object({ id: z.string().min(1).max(40), name: z.string().min(1).max(120), region: z.string().max(240) }).strict()).max(20),
  hasMore: z.boolean(),
}).strict();
export type SchoolSearchResponse = z.infer<typeof schoolSearchResponseSchema>;
export const schoolSearchMessages = {
  idle: "학교 이름을 입력해 검색하거나 직접 입력해 주세요.",
  loading: "학교 이름을 찾고 있습니다.",
  empty: "검색된 학교가 없습니다. 입력한 이름을 그대로 사용할 수 있습니다.",
  error: "학교를 검색하지 못했습니다. 직접 입력하거나 다시 검색해 주세요.",
  unavailable: "학교 검색 연결이 준비되지 않았습니다. 학교 이름을 직접 입력해 주세요.",
  invalid: "학교 이름을 두 글자 이상 입력해 주세요.",
  auth: "관리자 로그인이 필요합니다.",
} as const;
export class SchoolSearchRequestError extends Error {
  constructor(readonly status: number, message: string = schoolSearchMessages.error) { super(message); }
}
