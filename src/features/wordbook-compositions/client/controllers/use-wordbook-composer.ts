"use client";

import { useEffect, useRef, useState } from "react";
import { createCompositionSchema, type CreatedComposition, type CreateCompositionInput, type SourceScope } from "../../contracts/composition";
import { EMPTY_SCOPE_FILTERS, matchesScope, changeVisibleSelection, summarizeScopeSelection, type ScopeFilters } from "../../domain/scope-selection";
import { CompositionRequestError, readCompositionCatalog, saveComposition } from "../transport/composition-transport";

export function useWordbookComposer(onSaved: (book: CreatedComposition) => void, captureAuthenticationFailure?: () => (error: unknown) => void) {
  const [catalog, setCatalog] = useState<{ status: "loading" | "ready" | "error"; scopes: SourceScope[]; error?: string }>({ status: "loading", scopes: [] });
  const [revision, setRevision] = useState(0);
  const [filters, setFilters] = useState<ScopeFilters>(EMPTY_SCOPE_FILTERS);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [title, setTitle] = useState("");
  const [saveState, setSaveState] = useState<{ status: "idle" | "saving" | "error"; error?: string; uncertain?: boolean }>({ status: "idle" });
  const pending = useRef<CreateCompositionInput | null>(null);
  const confirmed = useRef<CreatedComposition | null>(null);
  const [selectedSources, setSelectedSources] = useState(new Map<string, SourceScope>());
  const saving = useRef(false);
  const mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  useEffect(() => {
    const controller = new AbortController();
    const reportAuthenticationFailure = captureAuthenticationFailure?.();
    void readCompositionCatalog(controller.signal).then(scopes => {
      if (!controller.signal.aborted) setCatalog({ status: "ready", scopes });
    }).catch(error => {
      if (!controller.signal.aborted) {
        reportAuthenticationFailure?.(error);
        setCatalog(current => ({ ...current, status: "error", error: error instanceof CompositionRequestError ? error.message : "범위를 불러오지 못했습니다." }));
      }
    });
    return () => controller.abort();
  }, [revision, captureAuthenticationFailure]);
  const summary = summarizeScopeSelection([...new Map([...catalog.scopes.map(s => [s.id, s] as const), ...selectedSources]).values()], selectedIds);
  const staleIds = selectedIds.filter(id => !catalog.scopes.some(s => s.id === id && s.version === selectedSources.get(id)?.version));
  const visible = catalog.scopes.filter(s => matchesScope(s.metadata, filters));
  const locked = saveState.status === "saving" || Boolean(saveState.uncertain);
  async function save() {
    if (saving.current) return;
    if (confirmed.current) {
      try { onSaved(confirmed.current); } catch { setSaveState({ status: "error", uncertain: true, error: "단어장은 저장됐습니다. 다시 눌러 목록에 표시해 주세요." }); }
      return;
    }
    const parsed = createCompositionSchema.safeParse(pending.current ?? {
      requestId: crypto.randomUUID(), title,
      scopes: summary.scopes.map(s => ({ id: s.id, version: s.version })),
    });
    if (!parsed.success || (!pending.current && (summary.scopeCount !== selectedIds.length || staleIds.length))) {
      setSaveState({ status: "error", error: "단어장 이름과 담은 범위를 확인해 주세요." }); return;
    }
    pending.current = parsed.data;
    const wasUncertain = Boolean(saveState.uncertain);
    const reportAuthenticationFailure = captureAuthenticationFailure?.();
    saving.current = true; setSaveState({ status: "saving" });
    try {
      const created = await saveComposition(parsed.data);
      confirmed.current = created;
      if (mounted.current) {
        setSaveState({ status: "idle" });
        try { onSaved(created); } catch { setSaveState({ status: "error", uncertain: true, error: "단어장은 저장됐습니다. 다시 눌러 목록에 표시해 주세요." }); }
      }
    } catch (error) {
      if (mounted.current) {
        const definitive = error instanceof CompositionRequestError && [400, 401, 403, 404, 409, 422].includes(error.status) &&
          !(wasUncertain && [401, 403].includes(error.status));
        reportAuthenticationFailure?.(error);
        if (definitive) pending.current = null;
        if (error instanceof CompositionRequestError && [404, 409].includes(error.status)) setCatalog(current => ({ ...current, status: "error", error: "선택한 범위가 바뀌었습니다. 목록을 다시 불러온 뒤 표시된 범위를 확인해 주세요." }));
        setSaveState({ status: "error", uncertain: !definitive, error: error instanceof CompositionRequestError ? error.message : "저장 결과를 확인하지 못했습니다. 같은 내용으로 다시 확인해 주세요." });
      }
    } finally { saving.current = false; }
  }
  return { catalog, filters, title, selectedIds, summary, visible, saveState, locked, staleIds,
    actions: {
      setFilters, setTitle: (v: string) => { if (!locked) { setTitle(v); pending.current = null; } },
      toggle: (id: string) => { if (!locked) { const scope = catalog.scopes.find(s => s.id === id); if (scope && !selectedIds.includes(id)) setSelectedSources(current=>new Map(current).set(id,scope)); setSelectedIds(current => changeVisibleSelection(current, [id], !current.includes(id))); pending.current = null; } },
      toggleVisible: (include: boolean) => { if (!locked) { if (include) setSelectedSources(current=>new Map([...current,...visible.filter(s=>!selectedIds.includes(s.id)).map(s=>[s.id,s] as const)])); setSelectedIds(current => changeVisibleSelection(current, visible.map(s => s.id), include)); pending.current = null; } },
      clear: () => { if (!locked) { setSelectedIds([]); pending.current = null; } },
      reload: () => { if (!locked) { setCatalog(current => ({ ...current, status: "loading", error: undefined })); setRevision(v => v + 1); } },
      save,
    },
  };
}
