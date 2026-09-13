import { z } from "zod";
import { schoolEventSchema, schoolKeySchema, type SchoolScheduleOverview } from "./school-schedule";
export const scheduleScopeSchema = z.object({
  schoolKey: schoolKeySchema, academicYear: z.number().int().min(2020).max(2200), semester: z.number().int().min(1).max(2),
}).strict();
export const scheduleEditorGroupSchema = z.object({
  schoolKey: schoolKeySchema, schoolName: z.string().min(1).max(120), schoolLevel: z.enum(["중", "고"]),
  grade: z.number().int().min(1).max(3), gradeLabel: z.string(), studentCount: z.number().int().positive(),
}).strict();
export const scheduleEditorSnapshotSchema = scheduleScopeSchema.extend({
  sourceVersionId: z.string().max(120).nullable(), manualRevision: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
  groups: z.array(scheduleEditorGroupSchema).min(1), events: z.array(schoolEventSchema).max(300),
  sourceChangedEventIds: z.array(z.string()),
}).strict().refine(snapshot => snapshot.groups.every(group => group.schoolKey === snapshot.schoolKey)
  && new Set(snapshot.events.map(event => event.id)).size === snapshot.events.length);
export const scheduleEditCommandSchema = scheduleScopeSchema.extend({
  requestId: z.uuid(), sourceVersionId: z.string().max(120).nullable(), manualRevision: z.number().int().nonnegative().max(999999999999999),
  event: schoolEventSchema.refine(event => event.sourceUrl === null && event.sourceLabel === "관리자 수동 입력"
    && event.title.trim().length > 0 && event.id.length <= 180
    && (!["week","month"].includes(event.precision) || event.dateText.trim().length > 0)
    && (!["day","range","week","month"].includes(event.precision) || ["confirmed","planned"].includes(event.status))),
}).strict();
export const scheduleEditReceiptSchema = scheduleScopeSchema.extend({
  requestId: z.uuid(), revision: z.number().int().positive(), eventId: z.string(),
}).strict();
export type ScheduleScope = z.infer<typeof scheduleScopeSchema>;
export type ScheduleEditorSnapshot = z.infer<typeof scheduleEditorSnapshotSchema>;
export type ScheduleEditCommand = z.infer<typeof scheduleEditCommandSchema>;
export type ScheduleEditReceipt = z.infer<typeof scheduleEditReceiptSchema>;
export type ScheduleFailure = { ok: false; status: 400 | 401 | 404 | 409 | 503; error: string; outcome?: "unknown" };
export type ScheduleReadResult = { ok: true; snapshot: ScheduleEditorSnapshot } | ScheduleFailure;
export type ScheduleSaveResult = { ok: true; receipt: ScheduleEditReceipt } | ScheduleFailure;
export type ScheduleRecoveryResult = { ok: true; receipt: ScheduleEditReceipt | null } | ScheduleFailure;
export type ScheduleEditorInitial = {
  overview: SchoolScheduleOverview; scope: ScheduleScope | null; grade: number; eventId: string | null; result: ScheduleReadResult | null;
};
