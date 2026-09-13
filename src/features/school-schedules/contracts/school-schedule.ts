import { z } from "zod";

export const schoolKeySchema = z.string().regex(/^[A-Z][0-9]{2}:[0-9]{7}$/);
const date = z.iso.date();
export const schoolEventSchema = z.object({
  id: z.string().min(1), grade: z.number().int().min(1).max(3),
  kind: z.enum(["written", "performance"]), round: z.number().int().min(1).max(2).nullable(),
  title: z.string().min(1).max(240), subject: z.string().max(80).nullable(),
  startDate: date.nullable(), endDate: date.nullable(),
  precision: z.enum(["day", "range", "week", "month", "unknown", "none"]),
  status: z.enum(["confirmed", "planned", "unknown", "not-held"]),
  dateText: z.string().max(300), maxPoints: z.number().min(0).max(1000).nullable(),
  applicability: z.enum(["grade", "enrollment-unconfirmed"]),
  // School source links use public HTTPS hostnames; keep the database validator aligned.
  sourceUrl: z.url().regex(/^https:\/\/[A-Za-z0-9][A-Za-z0-9.-]*\.[A-Za-z]{2,}([/?#][^\s\\]*)?$/).nullable(),
  sourceLabel: z.string().trim().min(1).max(120).optional(),
}).strict().superRefine((event, context) => {
  const fail = (message: string) => context.addIssue({ code: "custom", message });
  if (event.sourceUrl === null && !event.sourceLabel) fail("학교 배부물의 출처를 확인해 주세요.");
  if (["day", "range"].includes(event.precision)) {
    if (!event.startDate || !event.endDate || event.endDate < event.startDate) fail("날짜 범위를 확인해 주세요.");
    if (event.precision === "day" && event.startDate !== event.endDate) fail("날짜가 일치해야 합니다.");
  } else if (event.startDate !== null || event.endDate !== null) fail("확인되지 않은 날짜를 임의 지정할 수 없습니다.");
  if (event.status === "not-held" && event.precision !== "none") fail("미실시 일정에는 날짜가 없습니다.");
  if (event.precision === "none" && event.status !== "not-held") fail("미실시 상태를 확인해 주세요.");
  if (event.precision === "unknown" && event.status !== "unknown") fail("미확인 상태를 확인해 주세요.");
  if (event.kind === "written" && event.round === null) fail("시험 차수를 확인해 주세요.");
});
export const schoolScheduleBundleSchema = z.object({
  schoolKey: schoolKeySchema, schoolName: z.string().min(1).max(120), schoolLevel: z.enum(["중", "고"]),
  academicYear: z.number().int().min(2020).max(2200), semester: z.number().int().min(1).max(2),
  versionId: z.string().min(1).max(120), sourceHash: z.string().regex(/^[a-f0-9]{64}$/), checkedOn: date,
  events: z.array(schoolEventSchema).max(300),
}).strict().superRefine((bundle, context) => {
  if (new Set(bundle.events.map(event => event.id)).size !== bundle.events.length) {
    context.addIssue({ code: "custom", message: "일정 식별자가 중복되었습니다." });
  }
});
export type SchoolEvent = z.infer<typeof schoolEventSchema>;
export type SchoolScheduleBundle = z.infer<typeof schoolScheduleBundleSchema>;
export type SchoolScheduleEvent = SchoolEvent & { semester: number; academicYear: number; checkedOn: string };
export type SchoolScheduleSummary = {
  status: "ready" | "missing-profile" | "unlinked" | "unregistered" | "error";
  schoolKey: string | null; schoolName: string | null; gradeLabel: string | null;
  today: string; events: SchoolScheduleEvent[];
};
export type SchoolScheduleGroup = { summary: SchoolScheduleSummary; studentCount: number };
export type SchoolScheduleOverview = { status: "ready" | "error"; today: string; groups: SchoolScheduleGroup[] };

// This also validates summaries restored from the existing private directory cache.
export const schoolScheduleSummarySchema = z.object({
  status: z.enum(["ready", "missing-profile", "unlinked", "unregistered", "error"]),
  schoolKey: schoolKeySchema.nullable(), schoolName: z.string().nullable(), gradeLabel: z.string().nullable(),
  today: date,
  events: z.array(schoolEventSchema.safeExtend({ semester: z.number().int().min(1).max(2), academicYear: z.number().int(), checkedOn: date })),
}).strict();
