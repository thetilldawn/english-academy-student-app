import type { SchoolEvent } from "../contracts/school-schedule";
import { schoolEventSchema } from "../contracts/school-schedule";
export type ScheduleDraft = {
  id: string; title: string; kind: "written" | "performance"; subject: string; round: string;
  precision: SchoolEvent["precision"]; status: "confirmed" | "planned"; startDate: string; endDate: string;
  dateText: string; maxPoints: string; applicability: SchoolEvent["applicability"]; subjectDate: string;
};
export function draftFromEvent(event?: SchoolEvent): ScheduleDraft {
  return {
    id: event?.id ?? "", title: event?.title ?? "", kind: event?.kind ?? "performance", subject: event?.subject ?? "",
    round: String(event?.round ?? 1), precision: event?.precision ?? "day", status: event?.status === "planned" ? "planned" : "confirmed",
    startDate: event?.startDate ?? "", endDate: event?.endDate ?? "", dateText: event?.dateText ?? "",
    subjectDate: event?.subjectDate ?? "",
    maxPoints: event?.maxPoints === null || event?.maxPoints === undefined ? "" : String(event.maxPoints),
    applicability: event?.applicability ?? "grade",
  };
}
export function eventFromDraft(draft: ScheduleDraft, grade: number, newId: string) {
  const dated = ["day","range"].includes(draft.precision);
  return schoolEventSchema.safeParse({
    id: draft.id || newId, grade, title: draft.title.trim(), kind: draft.kind, subject: draft.subject.trim() || null,
    round: draft.kind === "written" ? Number(draft.round) : null, precision: draft.precision,
    status: draft.precision === "unknown" ? "unknown" : draft.precision === "none" ? "not-held" : draft.status,
    startDate: dated ? draft.startDate || null : null,
    endDate: dated ? (draft.precision === "day" ? draft.startDate : draft.endDate) || null : null,
    ...(draft.kind === "written" ? { subjectDate: draft.precision === "none" ? null : draft.subjectDate || null } : {}),
    dateText: dated ? draft.startDate + (draft.precision === "range" ? " ~ " + draft.endDate : "") : draft.dateText.trim(),
    maxPoints: draft.maxPoints === "" ? null : Number(draft.maxPoints), applicability: draft.applicability,
    sourceUrl: null, sourceLabel: "관리자 수동 입력",
  });
}
