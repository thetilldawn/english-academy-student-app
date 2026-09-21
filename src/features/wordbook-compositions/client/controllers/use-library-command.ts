"use client";
import { useEffect, useRef, useState } from "react";
import { type CreatedLibraryBook } from "../../contracts/library";
import { libraryCommandV2Schema, type LibraryCommandV2, type LibraryCommandV2Result } from "../../contracts/library-command-v2";
import { LibraryRequestError, sendLibraryCommandV2 } from "../transport/library-transport";

export function useLibraryCommand(viewerId: string | undefined, onResult: (result: LibraryCommandV2Result) => void,
  onError: (error: unknown) => void, onSaved?: (book: CreatedLibraryBook) => void) {
  const [state, setState] = useState<{ status: "idle" | "saving" | "error"; uncertain: boolean; error: string }>({ status: "idle", uncertain: false, error: "" });
  const pending = useRef<{ command: LibraryCommandV2; viewerId: string; makeBook: boolean } | null>(null);
  const confirmed = useRef<CreatedLibraryBook | null>(null), busy = useRef(false), mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  async function run(input?: LibraryCommandV2, makeBook = false) {
    if (busy.current || !viewerId) return;
    if (pending.current && pending.current.viewerId !== viewerId) { onError(new LibraryRequestError(403, "처음 저장한 관리자 계정으로 로그인해 주세요.")); return; }
    if (!pending.current && !confirmed.current) {
      const parsed = libraryCommandV2Schema.safeParse(input);
      if (!parsed.success) { setState({ status: "error", uncertain: false, error: "이름과 선택한 범위를 확인해 주세요." }); return; }
      pending.current = { command: parsed.data, viewerId, makeBook };
    }
    const wasUncertain = state.uncertain;
    busy.current = true; setState({ status: "saving", uncertain: false, error: "" });
    try {
      while (pending.current) {
        const current = pending.current;
        const result = await sendLibraryCommandV2(current.command, current.viewerId);
        if (!mounted.current) return;
        if (current.makeBook && "template" in result && current.command.action !== "materialize") {
          const t = result.template, v = t.latestVersion;
          pending.current = { viewerId: current.viewerId, makeBook: false, command: { action: "materialize", requestId: crypto.randomUUID(), templateId: t.id, versionId: v.id, contentHash: v.contentHash } };
          continue;
        }
        pending.current = null; onResult(result);
        if ("createdBook" in result && result.createdBook?.dataset.isAssignable && result.createdBook.dataset.isActive && result.createdBook.dataset.status === "ready" && result.createdBook.dataset.availableQuestionModes.length) confirmed.current = result.createdBook;
      }
      if (confirmed.current) { await onSaved?.(confirmed.current); confirmed.current = null; }
      if (mounted.current) setState({ status: "idle", uncertain: false, error: "" });
    } catch (error) {
      if (!mounted.current) return;
      const auth = error instanceof LibraryRequestError && [401, 403].includes(error.status);
      const definitive = error instanceof LibraryRequestError && [400, 401, 403, 404, 409, 422].includes(error.status) && !((wasUncertain || error.progressConfirmed) && auth);
      if (definitive) pending.current = null;
      onError(error);
      setState({ status: "error", uncertain: !!confirmed.current || !definitive, error: confirmed.current
        ? "단어장은 저장됐습니다. 다시 눌러 시험 설정에 연결해 주세요." : error instanceof LibraryRequestError ? error.message : "저장 결과를 확인하지 못했습니다. 같은 내용으로 다시 확인해 주세요." });
    } finally { busy.current = false; }
  }
  return { state, locked: state.status === "saving" || state.uncertain, run,
    reset: () => { if (!busy.current && !state.uncertain) { pending.current = null; setState({ status: "idle", uncertain: false, error: "" }); } } };
}
