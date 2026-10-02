"use client";

import { useCallback, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { AssignmentDatasetItem, AssignmentStudentItem, AssignmentUnitItem } from "../catalog-types";
import type { MixedMistakePreview, MixedMistakeResult } from "../contracts/mixed-mistake-assignment";
import { createAssignmentEditorState, reduceAssignmentEditorState, type AssignmentEditorAction, type AssignmentEditorState } from "../domain/editor-state";
import type { SingleAssignmentDraft } from "../domain/model";
import { reduceSingleAssignmentDraft, resolveSingleAssignmentDraft, type SingleAssignmentDraftAction } from "../domain/single-draft";
import { createAssignmentSubmissionFlow, type AssignmentSubmissionOutcome } from "../application/submission-flow";
import { prepareMixedMistakePreview, prepareMixedMistakeSubmission, resolveMixedMistakeSubmissionIssues } from "../application/mixed-mistake-flow-adapter";
import type { AssignmentOperationError } from "../application/assignment-operation-error";
import type { AssignmentRequestIdentity } from "../application/request-lifecycle";
import { browserAssignmentTransport, type AssignmentTransport } from "../transport/assignment-transport";
import { useAssignmentAuthenticationFailure } from "./assignment-authentication-boundary";
import { createInitialSingleAssignmentDraft } from "../domain/single-draft";
import { useAssignmentMinuteClock, useAssignmentSubmissionSession } from "./use-assignment-controller-runtime";
import { useDebouncedAssignmentPreview } from "./use-debounced-assignment-preview";

type State = AssignmentEditorState<SingleAssignmentDraft, MixedMistakePreview, MixedMistakeResult>;
type Action = AssignmentEditorAction<SingleAssignmentDraft, MixedMistakePreview, MixedMistakeResult>;
type Outcome = { ok: true; result: MixedMistakeResult } | { ok: false; conflict: boolean; message: string };
type Options = {
  audienceMode: "single" | "bulk"; student: AssignmentStudentItem | null;
  datasets: readonly AssignmentDatasetItem[]; units: readonly AssignmentUnitItem[];
  enabled: boolean; initialDatasetId?: string; initialUnitIds?: readonly string[];
  unitLoadState?: { datasetId: string; status: "idle" | "loading" | "ready" | "error" };
  previewDelayMs?: number; clock?: () => number; transport?: AssignmentTransport;
};
const defaultClock = () => Date.now();
const locked = (s: State) => ["submitting", "uncertain", "succeeded"].includes(s.submission.status);
const resolve = (draft: SingleAssignmentDraft) => resolveSingleAssignmentDraft(draft, { title: "범위+오답 시험" });
const confirmationKey = (s: State) => s.preview.status === "ready" && s.preview.revision === s.revision && s.preview.value.selectionFingerprint
  ? `${s.revision}:${s.preview.requestId}:${s.preview.value.selectionFingerprint}` : null;
const failure = (message: string, conflict = false): Outcome => ({ ok: false, conflict, message });
export function mixedMistakeFieldKey(path: string) {
  if (path === "range.datasetId") return "dataset";
  if (path.startsWith("range.")) return "range";
  if (path.startsWith("review")) return "reviewLevels";
  if (path.startsWith("exam.timing") || path === "exam.timeLimitEnabled") return "timing";
  if (path === "exam.directionRatio") return "direction";
  if (path === "exam.questionOrderMode") return "questionOrder";
  return path.replace(/^exam\./, "");
}

export function useMixedMistakeAssignmentController({
  audienceMode, student, datasets, units, enabled, initialDatasetId = "", initialUnitIds,
  unitLoadState, previewDelayMs = 250, clock = defaultClock, transport = browserAssignmentTransport,
}: Options) {
  const captureAuthenticationFailure = useAssignmentAuthenticationFailure();
  const datasetOptions = useMemo(() => datasets.filter(d => d.status === "ready" && d.isActive && d.isAssignable &&
    !d.questionBankKind && d.vocabularyRole !== "composition"), [datasets]);
  const [state, setState] = useState<State>(() => {
    const datasetId = [initialDatasetId, student?.currentVocabDatasetId].find(id => datasetOptions.some(d => d.id === id)) ?? datasetOptions[0]?.id ?? "";
    const firstUnit = units.filter(u => u.datasetId === datasetId).toSorted((a, b) => a.sortIndex - b.sortIndex)[0];
    const draft = createInitialSingleAssignmentDraft({ studentId: student?.id ?? "", datasetId, orderedUnitIds: initialUnitIds ?? (firstUnit ? [firstUnit.id] : []) });
    return createAssignmentEditorState({ ...draft, questionCount: { mode: "manual", value: draft.questionCount.value },
      review: { mode: "pending", scope: "dataset", levels: [1, 2] } });
  });
  const stateRef = useRef(state);
  const apply = useCallback((action: Action) => {
    const next = reduceAssignmentEditorState(stateRef.current, action);
    stateRef.current = next; setState(next); return next;
  }, []);
  const [userEdited, setUserEdited] = useState(false);
  const [feedback, setFeedback] = useState("");
  const [confirmed, setConfirmed] = useState({ exclusions: null as string | null, banks: null as string | null });
  const session = useAssignmentSubmissionSession();
  const running = useRef(false);
  const owner = useRef<object | null>(null);
  // Planner is keyed by student/audience; the authentication boundary remounts on account changes.
  // Transport/callback identity alone must not orphan an accepted in-flight save.
  useLayoutEffect(() => { owner.current = {}; return () => { owner.current = null; }; }, []);
  const previewTransportRef = useRef<AssignmentTransport | null>(null);
  const [previewTransport, setPreviewTransport] = useState<AssignmentTransport | null>(null);
  const active = enabled && audienceMode === "single" && student !== null && student.id === state.draft.studentId;
  const activeRef = useRef(active);
  const fingerprintRef = useRef<string | null>(null);
  const now = useAssignmentMinuteClock({ clock, initializeFromClock: true });
  const resolved = useMemo(() => resolve(state.draft), [state.draft]);
  const issues = useMemo(() => {
    const ready = !unitLoadState || (unitLoadState.status === "ready" && unitLoadState.datasetId === state.draft.range.datasetId);
    return resolveMixedMistakeSubmissionIssues({ draft: state.draft, resolved, datasetIds: datasetOptions.map(d => d.id),
      unitIds: units.filter(u => u.datasetId === state.draft.range.datasetId).map(u => u.id), unitsReady: ready }, now);
  }, [state.draft, resolved, now, datasetOptions, unitLoadState, units]);
  const preparation = useMemo(() => {
    if (issues.length) return null;
    try { return prepareMixedMistakePreview({ draft: state.draft, resolved }); } catch { return null; }
  }, [state.draft, resolved, issues.length]);
  useLayoutEffect(() => { activeRef.current = active; fingerprintRef.current = preparation?.fingerprint ?? null; }, [active, preparation]);
  const editingLocked = locked(state);
  const acceptsPreview = useCallback((identity: AssignmentRequestIdentity) => owner.current !== null && activeRef.current && !locked(stateRef.current) &&
    identity.revision === stateRef.current.revision && identity.fingerprint === fingerprintRef.current, []);
  const onRequested = useCallback((identity: AssignmentRequestIdentity) => {
    if (acceptsPreview(identity)) { previewTransportRef.current = transport; setPreviewTransport(() => transport); apply({ type: "preview/requested", ...identity }); }
  }, [acceptsPreview, apply, transport]);
  const onSucceeded = useCallback((value: MixedMistakePreview, identity: AssignmentRequestIdentity) => {
    if (acceptsPreview(identity)) { apply({ type: "preview/succeeded", ...identity, value }); setFeedback(""); }
  }, [acceptsPreview, apply]);
  const onFailed = useCallback((error: AssignmentOperationError, identity: AssignmentRequestIdentity) => {
    if (acceptsPreview(identity)) apply({ type: "preview/failed", ...identity, message: error.message });
  }, [acceptsPreview, apply]);
  const settled = (state.preview.status === "ready" || state.preview.status === "error") && state.preview.revision === state.revision && state.preview.fingerprint === preparation?.fingerprint && previewTransport === transport;
  useDebouncedAssignmentPreview({ delayMs: previewDelayMs, enabled: active && preparation !== null && !editingLocked && !settled,
    preparation, refreshVersion: 0, revision: state.revision, transport, onRequested, onSucceeded, onFailed });
  const value = active && state.preview.status === "ready" && (editingLocked || settled) ? state.preview.value : null;
  const key = value ? confirmationKey(state) : null;
  const exclusionsConfirmed = Boolean(value && (value.unavailableCount === 0 || (key && confirmed.exclusions === key)));
  const banksConfirmed = Boolean(value && (value.banks.length <= 1 || (key && confirmed.banks === key)));
  const canSubmit = active && !editingLocked && issues.length === 0 && value !== null && value.error === null && key !== null && exclusionsConfirmed && banksConfirmed;
  const flow = useMemo(() => createAssignmentSubmissionFlow({ busyMessage: "범위+오답 시험을 저장하고 있습니다.", fallback: "범위+오답 시험을 배정하지 못했습니다.",
    clock, createIdempotencyKey: () => crypto.randomUUID(), createRequestId: () => crypto.randomUUID(), retainUncertainSubmission: true, session, transport }), [clock, session, transport]);
  const recoveryFlow = useRef(flow);

  function dispatch(action: SingleAssignmentDraftAction) {
    const current = stateRef.current;
    if (!activeRef.current || locked(current) || session.retained()) return;
    if (action.type === "student/changed" || (action.type === "availability/changed" && action.availability.mode !== "immediate") ||
      (action.type === "review/changed" && action.review.mode !== "pending")) return;
    const draft = reduceSingleAssignmentDraft(current.draft, action);
    if (draft === current.draft) return;
    setUserEdited(true); setFeedback(""); setConfirmed({ exclusions: null, banks: null }); apply({ type: "draft/replaced", draft });
  }
  function retryPreview() {
    if (!activeRef.current || locked(stateRef.current) || session.retained()) return;
    setFeedback(""); setConfirmed({ exclusions: null, banks: null }); apply({ type: "draft/replaced", draft: stateRef.current.draft });
  }
  function changeUnits(unitId: string | null, allSelected?: boolean) {
    const range = stateRef.current.draft.range;
    const eligible = units.filter(unit => unit.datasetId === range.datasetId).toSorted((a, b) => a.sortIndex - b.sortIndex);
    const selected = new Set(range.orderedUnitIds);
    if (unitId) { if (!eligible.some(unit => unit.id === unitId)) return; if (selected.has(unitId)) selected.delete(unitId); else selected.add(unitId); }
    dispatch({ type: "range/changed", range: { ...range, orderedUnitIds: eligible.filter(unit => unitId ? selected.has(unit.id) : allSelected).map(unit => unit.id) } });
  }
  function confirm(which: "exclusions" | "banks", checked: boolean) {
    if (!activeRef.current || locked(stateRef.current) || !key || confirmationKey(stateRef.current) !== key) return;
    setConfirmed(current => ({ ...current, [which]: checked ? key : null }));
  }
  async function runSave(recovering: boolean): Promise<Outcome> {
    const current = stateRef.current;
    if (!activeRef.current || !owner.current || running.current || current.submission.status === "succeeded") return failure("현재 저장 요청이 끝난 뒤 다시 확인해 주세요.");
    let execute: () => Promise<AssignmentSubmissionOutcome<MixedMistakeResult>>;
    let fingerprint: string;
    if (recovering) {
      if (current.submission.status !== "uncertain" || !session.retained()) return failure("확인할 저장 요청이 없습니다.");
      fingerprint = current.submission.fingerprint; execute = () => recoveryFlow.current.recover<MixedMistakeResult>();
    } else {
      const preview = current.preview, currentKey = confirmationKey(current);
      if (locked(current) || session.retained() || issues.length || preview.status !== "ready" || preview.revision !== current.revision ||
        preview.fingerprint !== fingerprintRef.current || previewTransportRef.current !== transport || preview.value.error || !currentKey) return failure(issues[0]?.message ?? "최신 미리보기를 확인해 주세요.");
      const excludeUnavailableConfirmed = preview.value.unavailableCount === 0 || confirmed.exclusions === currentKey;
      const confirmedBanks = preview.value.banks.length <= 1 || confirmed.banks === currentKey;
      if (!excludeUnavailableConfirmed || !confirmedBanks) return failure("제외할 오답과 나누어 배정할 시험을 확인해 주세요.");
      const prepared = prepareMixedMistakeSubmission({ draft: current.draft, resolved: resolve(current.draft), preview: preview.value,
        excludeUnavailableConfirmed, banksConfirmed: confirmedBanks }, clock());
      if (!prepared.ok) { setFeedback(prepared.error.message); return failure(prepared.error.message); }
      recoveryFlow.current = flow;
      fingerprint = prepared.value.fingerprint; execute = () => flow.run(() => prepared); apply({ type: "submission/reset" });
    }
    const requestId = crypto.randomUUID(), startedIn = owner.current;
    const reportAuthenticationFailure = captureAuthenticationFailure();
    running.current = true;
    apply({ type: "submission/requested", revision: current.revision, requestId, fingerprint }); setFeedback("");
    try {
      const outcome = await execute();
      if (owner.current !== startedIn) return failure("이전 화면의 저장 응답입니다. 현재 배정 화면을 다시 확인해 주세요.");
      if (outcome.ok) { apply({ type: "submission/succeeded", revision: current.revision, requestId, result: outcome.value }); return { ok: true, result: outcome.value }; }
      reportAuthenticationFailure(outcome.error);
      if (recovering || outcome.uncertain) {
        const message = "저장 결과를 확인하지 못했습니다. 같은 요청으로 다시 확인해 주세요.";
        apply({ type: "submission/uncertain", revision: current.revision, requestId, message }); setFeedback(message); return failure(message);
      }
      const refresh = outcome.error.code !== "idempotency_key_reused" && outcome.error.code !== "request_conflict" &&
        (outcome.error.status === 409 || outcome.error.recovery === "refresh_preview" || outcome.error.recovery === "refresh_summary_and_preview");
      apply({ type: refresh ? "submission/conflicted" : "submission/failed", revision: current.revision, requestId, message: outcome.error.message });
      if (refresh) setConfirmed({ exclusions: null, banks: null });
      setFeedback(outcome.error.message); return failure(outcome.error.message, outcome.error.kind === "conflict");
    } finally { running.current = false; }
  }
  return {
    datasetId: state.draft.range.datasetId, onDatasetChange: (datasetId: string) => dispatch({ type: "dataset/changed", datasetId }),
    datasetOptions, draft: state.draft, state, dispatch, resolved, preview: state.preview, value, issues, userEdited,
    busy: state.submission.status === "submitting", editingLocked, canSubmit, status: state.submission.status,
    uncertain: state.submission.status === "uncertain", succeeded: state.submission.status === "succeeded",
    calculationPending: active && preparation !== null && !editingLocked && !settled,
    message: feedback || value?.error || (state.preview.status === "error" ? state.preview.message : ""),
    exclusionsConfirmed, banksConfirmed, submit: () => runSave(false), recover: () => runSave(true), retryPreview,
    firstFieldKey: issues[0] ? mixedMistakeFieldKey(issues[0].path) : !canSubmit ? "preview" : null,
    toggleUnit: (unitId: string) => changeUnits(unitId), toggleAllUnits: (selected: boolean) => changeUnits(null, selected),
    confirmExclusions: (checked: boolean) => confirm("exclusions", checked), confirmBanks: (checked: boolean) => confirm("banks", checked),
  };
}
export type MixedMistakeAssignmentController = ReturnType<typeof useMixedMistakeAssignmentController>;
