import { z } from "zod";
import { readingCurriculumStages } from "@/lib/admin/reading-curriculum";
import { mistakeTargetSchema } from "./mistake-episode";

export const createLegacyWrongWordWorksheetRequestSchema = z.object({
  questionIds: z.array(z.uuid()).min(1).max(50), curriculumStage: z.enum(readingCurriculumStages),
}).strict().refine(value => new Set(value.questionIds).size === value.questionIds.length,
  { message: "같은 오답 단어를 두 번 선택할 수 없습니다.", path: ["questionIds"] });

export const createWrongWordWorksheetRequestSchema = z.union([
  createLegacyWrongWordWorksheetRequestSchema,
  z.object({ targets: z.array(mistakeTargetSchema).min(1).max(50), curriculumStage: z.enum(readingCurriculumStages) }).strict()
    .refine(value => new Set(value.targets.map(target => target.meaningKey)).size === value.targets.length,
      { message: "같은 뜻을 두 번 선택할 수 없습니다.", path: ["targets"] }),
]);
