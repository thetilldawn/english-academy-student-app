"use client";
import { useEffect, useRef, useState } from "react";
import { announceAdminPrivateCacheChange } from "@/features/session/public-client";
import { readSchoolScheduleEditorAction, saveSchoolScheduleEventAction, readSchoolScheduleSaveResultAction } from "../actions/edit-school-schedule";
import type { ScheduleEditorInitial, ScheduleEditorSnapshot, ScheduleEditCommand, ScheduleEditReceipt, ScheduleFailure } from "../contracts/school-schedule-edit";
import { draftFromEvent, eventFromDraft, type ScheduleDraft } from "../domain/school-schedule-edit";

async function bounded<T>(promise: Promise<T>): Promise<T> {
  let timer: ReturnType<typeof setTimeout>;
  try { return await Promise.race([promise, new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error("timeout")), 20000); })]); }
  finally { clearTimeout(timer!); }
}
const copy = (draft: ScheduleDraft) => JSON.stringify(draft);
export function useSchoolScheduleEditor(initial: ScheduleEditorInitial) {
  const snapshotAtStart = initial.result?.ok ? initial.result.snapshot : null;
  const eventAtStart = snapshotAtStart?.events.find(event => event.id === initial.eventId && event.grade === initial.grade);
  const [snapshot, setSnapshot] = useState<ScheduleEditorSnapshot | null>(snapshotAtStart);
  const [scope, setScope] = useState(initial.scope);
  const [grade, setGrade] = useState(initial.grade);
  const [draft, setDraft] = useState(() => draftFromEvent(eventAtStart));
  const [baseline, setBaseline] = useState(() => copy(draftFromEvent(eventAtStart)));
  const [busy, setBusy] = useState(false);
  const [locked, setLocked] = useState(initial.result?.ok === false && initial.result.status === 401);
  const [message, setMessage] = useState(initial.result?.ok === false ? initial.result.error : initial.eventId && !eventAtStart ? "선택한 일정을 찾지 못했습니다. 목록에서 다시 선택해 주세요." : "");
  const [problem, setProblem] = useState<"load" | "validation" | "conflict" | "unknown" | null>(initial.result?.ok === false ? "load" : null);
  const pending = useRef<ScheduleEditCommand | null>(null);
  const inFlight = useRef(false);
  const alive = useRef(true);
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
  const dirty = copy(draft) !== baseline;
  function failure(result: ScheduleFailure) {
    setMessage(result.error);
    if (result.status === 401) { const empty = draftFromEvent(); setLocked(true); setSnapshot(null); setDraft(empty); setBaseline(copy(empty)); setProblem(null); pending.current = null; announceAdminPrivateCacheChange("identity"); }
    else if (result.outcome === "unknown") setProblem("unknown");
    else if (result.status === 409) { pending.current = null; setProblem("conflict"); }
    else { pending.current = null; setProblem("validation"); }
  }
  async function run(work: () => Promise<void>) {
    if (inFlight.current || locked) return;
    inFlight.current = true; setBusy(true);
    try { await work(); } finally { inFlight.current = false; if (alive.current) setBusy(false); }
  }
  async function load(nextScope = scope, nextGrade = grade, preserveDraft = false) {
    if (!nextScope) return;
    await run(async () => {
      try {
        const result = await bounded(readSchoolScheduleEditorAction(nextScope));
        if (!alive.current) return;
        if (!result.ok) { failure(result); setProblem("load"); return; }
        setScope(nextScope); setGrade(nextGrade); setSnapshot(result.snapshot); setProblem(null);
        if (preserveDraft) setMessage("최신 기준을 불러왔습니다. 작성한 내용을 검토한 뒤 저장해 주세요.");
        else { const empty = draftFromEvent(); setDraft(empty); setBaseline(copy(empty)); setMessage(""); }
      } catch { if (alive.current) { setMessage("일정을 불러오지 못했습니다. 입력은 유지했습니다."); setProblem("load"); } }
    });
  }
  function selectEvent(id: string) {
    if (inFlight.current || pending.current || locked) return;
    const event = snapshot?.events.find(item => item.id === id && item.grade === grade);
    const next = draftFromEvent(event); setDraft(next); setBaseline(copy(next)); setMessage(""); setProblem(null);
  }
  async function acceptReceipt(receipt: ScheduleEditReceipt) {
    const command = pending.current;
    if (!command || receipt.requestId !== command.requestId || receipt.eventId !== command.event.id || receipt.schoolKey !== command.schoolKey
      || receipt.academicYear !== command.academicYear || receipt.semester !== command.semester) {
      setProblem("unknown"); setMessage("저장 결과가 요청과 맞지 않습니다. 다시 확인해 주세요."); return;
    }
    pending.current = null;
    const next = draftFromEvent(command.event); setDraft(next); setBaseline(copy(next));
    setProblem(null); setMessage("변경사항을 저장했습니다.");
    setSnapshot(current => current ? { ...current, manualRevision: receipt.revision,
      events: [...current.events.filter(event => event.id !== command.event.id), command.event],
      sourceChangedEventIds: current.sourceChangedEventIds.filter(id => id !== command.event.id) } : current);
    announceAdminPrivateCacheChange("students");
  }
  async function save(retrySameRequest = false) {
    if (!snapshot || !scope || (pending.current && !retrySameRequest)) return;
    const parsed = eventFromDraft(draft, grade, "manual:" + crypto.randomUUID());
    if (!parsed.success) { setMessage(parsed.error.issues[0]?.message ?? "일정 이름과 날짜를 확인해 주세요."); setProblem("validation"); return; }
    await run(async () => {
      const command = pending.current ?? { ...scope, sourceVersionId: snapshot.sourceVersionId, manualRevision: snapshot.manualRevision, event: parsed.data, requestId: crypto.randomUUID() };
      pending.current = command;
      try {
        const result = await bounded(saveSchoolScheduleEventAction(command));
        if (!alive.current) return;
        if (result.ok) await acceptReceipt(result.receipt); else failure(result);
      } catch { if (alive.current) { setProblem("unknown"); setMessage("저장 결과를 확인하지 못했습니다. 입력을 유지하고 중복 저장을 막았습니다."); } }
    });
  }
  async function recover() {
    const command = pending.current;
    if (!command) return;
    await run(async () => {
      try {
        const result = await bounded(readSchoolScheduleSaveResultAction({ requestId: command.requestId }));
        if (!alive.current) return;
        if (!result.ok) { if (result.status === 401) failure(result); else setMessage(result.error); return; }
        if (result.receipt) await acceptReceipt(result.receipt);
        else setMessage("아직 저장 결과가 없습니다. 다시 확인하거나 같은 요청으로 다시 저장할 수 있습니다.");
      } catch { if (alive.current) setMessage("저장 결과를 불러오지 못했습니다. 다시 확인해 주세요."); }
    });
  }
  return { snapshot, scope, grade, draft, dirty, busy, locked, message, problem,
    unresolved: problem === "unknown", sourceChanged: !!draft.id && !!snapshot?.sourceChangedEventIds.includes(draft.id),
    change: (patch: Partial<ScheduleDraft>) => { if (!inFlight.current && !pending.current && !locked) setDraft(current => ({ ...current, ...patch })); },
    load, selectEvent, save, recover };
}
