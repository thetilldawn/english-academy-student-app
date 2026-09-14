import { z } from "zod";
import { schoolScheduleBundleSchema } from "./school-schedule";

const entry = z.object({ grade: z.number().int().min(1).max(3), start_date: z.iso.date().nullable(), end_date: z.iso.date().nullable(), source_ids: z.array(z.string()).min(1) });
const originalSchema = z.object({
  schema_version: z.literal("school-schedule-1.0"), version_id: z.string(), checked_on: z.iso.date(),
  school: z.object({ name: z.string(), office_code: z.string(), neis_school_code: z.string() }),
  academic_year: z.number().int(), semester: z.number().int(),
  written_exams: z.array(entry.extend({ event_id: z.string(), round: z.number().int(), name: z.string(), status: z.enum(["공식확인", "미실시", "예정", "미확인"]),
    date_precision: z.enum(["날짜", "날짜범위", "주차", "월", "미확인", "해당없음"]), date_text: z.string(), english_test_date: z.iso.date().nullable().optional(), english_date_status: z.enum(["공식확인", "미확인", "미실시", "해당없음"]).optional() })),
  performance_assessments: z.array(entry.extend({ assessment_id: z.string(), subject: z.string(), task_text: z.string(), max_points: z.number(),
    date_status: z.enum(["공식확인", "미확인", "예정", "미실시"]), date_precision: z.enum(["날짜", "날짜범위", "주차", "월", "미확인", "해당없음"]), date_text: z.string().nullable(), applicability: z.string().optional() })),
  sources: z.array(z.object({ source_id: z.string(), url: z.url().nullable(), label: z.string().trim().min(1).max(120).optional() })),
});
const precision = { "날짜": "day", "날짜범위": "range", "주차": "week", "월": "month", "미확인": "unknown", "해당없음": "none" } as const;
const status = { "공식확인": "confirmed", "예정": "planned", "미확인": "unknown", "미실시": "not-held" } as const;
export function convertSchoolSchedule(source: unknown, sourceHash: string, schoolLevel: "중" | "고") {
  const original = originalSchema.parse(source);
  if (original.written_exams.some(event => event.english_test_date && event.english_date_status !== "공식확인")) throw new Error("영어 시험일의 공식 확인 근거가 필요합니다.");
  const sourceFields = (ids: string[]) => {
    const match = original.sources.find(item => item.source_id === ids[0]);
    if (!match) throw new Error("일정 출처를 찾을 수 없습니다.");
    return { sourceUrl: match.url, ...(match.label ? { sourceLabel: match.label } : {}) };
  };
  return schoolScheduleBundleSchema.parse({
    schoolKey: `${original.school.office_code}:${original.school.neis_school_code}`, schoolName: original.school.name, schoolLevel,
    academicYear: original.academic_year, semester: original.semester, versionId: original.version_id, sourceHash, checkedOn: original.checked_on,
    events: [
      ...original.written_exams.map(event => ({ id: event.event_id, grade: event.grade, kind: "written", round: event.round, title: event.name, subject: null,
        startDate: event.start_date, endDate: event.end_date, precision: precision[event.date_precision], status: status[event.status], dateText: event.date_text,
        subjectDate: event.english_test_date ?? null,
        maxPoints: null, applicability: "grade", ...sourceFields(event.source_ids) })),
      ...original.performance_assessments.map(event => ({ id: event.assessment_id, grade: event.grade, kind: "performance", round: null, title: event.task_text, subject: event.subject,
        startDate: event.start_date, endDate: event.end_date, precision: precision[event.date_precision], status: status[event.date_status], dateText: event.date_text ?? "",
        maxPoints: event.max_points, applicability: event.applicability === "학년 공통·학교 지정 과목의 학생 대상" ? "grade" : "enrollment-unconfirmed", ...sourceFields(event.source_ids) })),
    ],
  });
}
