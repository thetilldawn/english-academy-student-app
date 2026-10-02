"use client";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { type CreatedLibraryBook } from "../../contracts/library";
import { libraryWriteCommandSchema, type LibraryWriteCommand, type LibraryWriteResult } from "../../contracts/library-v3";
import { LibraryRequestError, sendLibraryCommandV2 } from "../transport/library-transport";

export function useLibraryCommand(viewerId: string | undefined, onResult: (result: LibraryWriteResult, command: LibraryWriteCommand) => void,
  onError: (error: unknown) => void, onSaved?: (book: CreatedLibraryBook) => void, onLibraryChanged?: () => Promise<void> | void, enabled = true) {
  const [state, setState] = useState<{ status: "idle" | "saving" | "error"; uncertain: boolean; error: string }>({ status: "idle", uncertain: false, error: "" });
  const pending = useRef<{ command: LibraryWriteCommand; viewerId: string; makeBook: boolean; materializeVersion?: { id: string; contentHash: string } } | null>(null);
  const confirmedChange = useRef<{ viewerId: string } | null>(null);
  const confirmed = useRef<{ viewerId: string; book: CreatedLibraryBook } | null>(null), busy = useRef(false), mounted = useRef(true);
  const context = useRef({ viewerId, enabled, generation: 0 });
  useLayoutEffect(() => {
    if (context.current.viewerId !== viewerId || context.current.enabled !== enabled) context.current = { viewerId, enabled, generation: context.current.generation + 1 };
  }, [viewerId, enabled]);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  async function run(input?: LibraryWriteCommand, makeBook = false, materializeVersion?: { id: string; contentHash: string }) {
    if (busy.current || !viewerId || !enabled) return;
    if (pending.current && pending.current.viewerId !== viewerId) { onError(new LibraryRequestError(403, "처음 저장한 관리자 계정으로 로그인해 주세요.")); return; }
    if (confirmedChange.current && confirmedChange.current.viewerId !== viewerId) { onError(new LibraryRequestError(403, "처음 저장한 관리자 계정으로 로그인해 주세요.")); return; }
    if (confirmed.current && confirmed.current.viewerId !== viewerId) { onError(new LibraryRequestError(403, "처음 저장한 관리자 계정으로 로그인해 주세요.")); return; }
    if (!pending.current && !confirmed.current && !confirmedChange.current) {
      const parsed = libraryWriteCommandSchema.safeParse(input);
      if (!parsed.success) { setState({ status: "error", uncertain: false, error: "이름과 선택한 범위를 확인해 주세요." }); return; }
      pending.current = { command: parsed.data, viewerId, makeBook, materializeVersion };
    }
    const wasUncertain = state.uncertain;
    const generation = context.current.generation;
    const stillActive = () => {
      if (!mounted.current) return false;
      if (!context.current.enabled || context.current.viewerId !== viewerId || context.current.generation !== generation) {
        setState({ status: "error", uncertain: true, error: "화면 상태가 바뀌었습니다. 처음 저장한 관리자 계정에서 저장 결과를 확인해 주세요." });
        return false;
      }
      return true;
    };
    busy.current = true; setState({ status: "saving", uncertain: false, error: "" });
    try {
      if (confirmedChange.current) { await onLibraryChanged?.(); if (!stillActive()) return; confirmedChange.current = null; }
      while (pending.current) {
        if (!stillActive()) return;
        const current = pending.current;
        const result = await sendLibraryCommandV2(current.command, current.viewerId);
        if (!stillActive()) return;
        if (current.makeBook && "template" in result && current.command.action !== "materialize") {
          const t = result.template, v = current.materializeVersion ?? t.latestVersion;
          pending.current = { viewerId: current.viewerId, makeBook: false, command: { action: "materialize", protocolVersion: 3, requestId: crypto.randomUUID(), templateId: t.id, versionId: v.id, contentHash: v.contentHash } };
          confirmedChange.current = { viewerId: current.viewerId };
          await onLibraryChanged?.(); if (!stillActive()) return; confirmedChange.current = null;
          continue;
        }
        pending.current = null; confirmedChange.current = { viewerId: current.viewerId }; onResult(result, current.command);
        if ("createdBook" in result && result.createdBook?.dataset.isAssignable && result.createdBook.dataset.isActive && result.createdBook.dataset.status === "ready" && result.createdBook.dataset.availableQuestionModes.length) confirmed.current = { viewerId: current.viewerId, book: result.createdBook };
      }
      if (confirmedChange.current) { await onLibraryChanged?.(); if (!stillActive()) return; confirmedChange.current = null; }
      if (!stillActive()) return;
      if (confirmed.current) { await onSaved?.(confirmed.current.book); if (!stillActive()) return; confirmed.current = null; }
      if (mounted.current) setState({ status: "idle", uncertain: false, error: "" });
    } catch (error) {
      if (!stillActive()) return;
      const auth = error instanceof LibraryRequestError && [401, 403].includes(error.status);
      const definitive = error instanceof LibraryRequestError && [400, 401, 403, 404, 409, 422].includes(error.status) && !((wasUncertain || error.progressConfirmed) && auth);
      if (definitive && !confirmedChange.current) pending.current = null;
      onError(error);
      setState({ status: "error", uncertain: !!confirmed.current || !!confirmedChange.current || !definitive, error: confirmedChange.current
        ? "저장은 완료됐습니다. 목록 갱신을 다시 확인해 주세요." : confirmed.current
          ? "단어장은 저장됐습니다. 다시 눌러 시험 설정에 연결해 주세요." : error instanceof LibraryRequestError ? error.message : "저장 결과를 확인하지 못했습니다. 같은 내용으로 다시 확인해 주세요." });
    } finally { busy.current = false; }
  }
  return { state, locked: state.status === "saving" || state.uncertain, run,
    reset: () => { if (!busy.current && !state.uncertain) { pending.current = null; setState({ status: "idle", uncertain: false, error: "" }); } } };
}
