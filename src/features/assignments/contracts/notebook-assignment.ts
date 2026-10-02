import {z} from 'zod';
import {notebookFiltersSchema} from '@/features/students/public-contracts';
import {practiceSettingsSchema} from '@/features/quiz-player/public-contracts';

export const notebookAssignmentSettingsSchema=practiceSettingsSchema.safeExtend({
 passingScore:z.number().int().min(0).max(100),retryEnabled:z.boolean(),retryPassingScore:z.number().int().min(0).max(100).nullable(),
}).superRefine((value,ctx)=>{if(value.retryEnabled !== (value.retryPassingScore!==null))ctx.addIssue({code:'custom',message:'다시풀기 점수를 확인해 주세요.'});});
export const notebookAssignmentInputSchema=z.object({
 requestKey:z.uuid(),studentIds:z.array(z.uuid()).min(1).max(210).refine(ids=>new Set(ids).size===ids.length),
 audienceMode:z.enum(['single','bulk']),filters:notebookFiltersSchema,settings:notebookAssignmentSettingsSchema,selectionVersion:z.literal(2).optional(),
}).strict().superRefine((value,ctx)=>{
 if(value.studentIds.length*value.settings.questionCount>10000)ctx.addIssue({code:'custom',message:'한 번에 10,000문항까지 배정할 수 있습니다.'});
 if(value.audienceMode==='single'&&value.studentIds.length!==1)ctx.addIssue({code:'custom',message:'단일 배정은 학생 한 명만 선택해 주세요.'});
});
export const notebookAssignmentSaveSchema=notebookAssignmentInputSchema.safeExtend({confirmation:z.string().regex(/^[a-f0-9]{64}$/),gradeConfirmedStudentIds:z.array(z.uuid()).max(210)});
export type NotebookAssignmentInput=z.infer<typeof notebookAssignmentInputSchema>;
export type NotebookAssignmentSave=z.infer<typeof notebookAssignmentSaveSchema>;
export type NotebookAssignmentSettings=z.infer<typeof notebookAssignmentSettingsSchema>;
const sourceLabel=z.object({id:z.uuid(),label:z.string(),gradeCode:z.string().nullable()});
export const notebookAssignmentStudentPreviewSchema=z.object({
 studentId:z.uuid(),displayName:z.string(),totalCount:z.number().int().nonnegative(),availableCount:z.number().int().nonnegative(),
 words:z.array(z.object({key:z.string(),headword:z.string(),primaryMeaning:z.string()})).max(500),
 excludedCount:z.number().int().nonnegative(),excluded:z.array(z.object({key:z.string(),headword:z.string(),reason:z.string()})).max(20),
 sources:z.array(sourceLabel),mismatchingSources:z.array(sourceLabel),error:z.string().nullable(),
 banks:z.array(z.object({index:z.number().int().nonnegative(),questionCount:z.number().int().min(1).max(500),
  quizContentMode:z.string(),englishToKoreanRatio:z.union([z.literal(0),z.literal(50),z.literal(100)]),timeLimitSeconds:z.number().int().min(30).nullable()})).max(500).optional(),
});
export const notebookAssignmentPreviewSchema=z.object({confirmation:z.string().nullable(),students:z.array(notebookAssignmentStudentPreviewSchema).min(1).max(210)});
export const notebookAssignmentResultSchema=z.array(z.object({studentId:z.uuid(),assignmentId:z.uuid(),questionCount:z.number().int().min(1).max(500)})).min(1).max(10000);
export type NotebookAssignmentPreview=z.infer<typeof notebookAssignmentPreviewSchema>;
export type NotebookAssignmentResult=z.infer<typeof notebookAssignmentResultSchema>;
