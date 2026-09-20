"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { EMPTY_LIBRARY_FILTERS, libraryCommandSchema, type LibraryCatalog, type LibraryCommand, type LibraryFilters,
  type LibraryRecipe, type LibraryTemplate, type LibraryVersion, type TemplateMetadata, type CreatedLibraryBook } from "../../contracts/library";
import { matchesLibraryScope, resolveLibraryRecipe } from "../../domain/library-selection";
import { changeVisibleSelection } from "../../domain/scope-selection";
import { compareLibraryVersions, latestLibraryVersion, matchesTemplate } from "../../domain/template-version";
import { LibraryRequestError, readLibrary, sendLibraryCommand } from "../transport/library-transport";

const emptyMetadata = (): TemplateMetadata => ({ title: "", tags: [], school: null, targetGrade: null, schoolYear: null, semester: null, assessment: null, purpose: null });
const emptyRecipe = (): LibraryRecipe => ({ filters: EMPTY_LIBRARY_FILTERS, scopes: [], excludedOccurrenceKeys: [], scopeStatus: "confirmed" });
type Editor = { mode: "create" | "metadata" | "version" | "copy"; template?: LibraryTemplate; version?: LibraryVersion };

export function useWordbookLibrary(captureAuthenticationFailure?: () => (error: unknown) => void, onSaved?: (book: CreatedLibraryBook) => void) {
  const [catalog, setCatalog] = useState<LibraryCatalog>({ viewerId: "00000000-0000-0000-0000-000000000000", scopes: [], templates: [] });
  const [loadState, setLoadState] = useState<"loading" | "ready" | "error">("loading");
  const [loadError, setLoadError] = useState("");
  const [reload, setReload] = useState(0);
  const [tab, setTab] = useState<"saved" | "sources">("saved");
  const [search, setSearch] = useState("");
  const [editor, setEditor] = useState<Editor>({ mode: "create" });
  const [editorRevision, setEditorRevision] = useState(0);
  const [metadata, setMetadata] = useState<TemplateMetadata>(emptyMetadata);
  const [recipe, setRecipe] = useState<LibraryRecipe>(emptyRecipe);
  const [saveState, setSaveState] = useState<{ status: "idle" | "saving" | "error"; error?: string; uncertain?: boolean }>({ status: "idle" });
  const [notice, setNotice] = useState("");
  const [authenticationFailed, setAuthenticationFailed] = useState(false);
  const [differentAdministrator, setDifferentAdministrator] = useState(false);
  const pending = useRef<LibraryCommand | null>(null), saving = useRef(false), mounted = useRef(true);
  const confirmedBook = useRef<CreatedLibraryBook | null>(null);
  const pendingAdministrator = useRef<string | null>(null);
  const requestEpoch = useRef(0);
  const locked = saveState.status === "saving" || Boolean(saveState.uncertain);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  useEffect(() => {
    const controller = new AbortController(); const epoch = ++requestEpoch.current;
    const reportAuth = captureAuthenticationFailure?.();
    void readLibrary(controller.signal).then(data => {
      if (!controller.signal.aborted && epoch === requestEpoch.current) {
        if (pending.current && pendingAdministrator.current !== data.viewerId) { setDifferentAdministrator(true); setAuthenticationFailed(true); setLoadState("error"); return; }
        setCatalog(data); setLoadState("ready"); setLoadError(""); setAuthenticationFailed(false); setDifferentAdministrator(false);
      }
    }).catch(error => {
      if (controller.signal.aborted || epoch !== requestEpoch.current) return;
      reportAuth?.(error);
      if (error instanceof LibraryRequestError && [401, 403].includes(error.status)) { setCatalog(c => ({ viewerId: c.viewerId, scopes: [], templates: [] })); setAuthenticationFailed(true); }
      setLoadState("error"); setLoadError(error instanceof LibraryRequestError ? error.message : "자료를 불러오지 못했습니다. 다시 시도해 주세요.");
    });
    return () => controller.abort();
  }, [reload, captureAuthenticationFailure]);

  const visible = useMemo(() => catalog.scopes.filter(s => matchesLibraryScope(s, recipe.filters)), [catalog.scopes, recipe.filters]);
  const templates = useMemo(() => catalog.templates.filter(t => matchesTemplate(t, search)), [catalog.templates, search]);
  const selection = useMemo(() => {
    try { return { result: resolveLibraryRecipe(catalog.scopes, recipe), error: false }; }
    catch { return { result: null, error: true }; }
  }, [catalog.scopes, recipe]);
  const difference = editor.version && selection.result ? compareLibraryVersions(editor.version, { includedKeys: selection.result.included.map(r => r.key) }) : null;
  const newestTemplate = editor.template && catalog.templates.find(t => t.id === editor.template!.id);
  const conflictingTemplate = newestTemplate && newestTemplate.revision !== editor.template?.revision ? newestTemplate : null;
  const scopesLocked = locked || editor.mode === "metadata" || editor.mode === "copy";
  function edit(change: () => void) {
    if (locked || saving.current) return;
    pending.current = null; confirmedBook.current = null; pendingAdministrator.current = null; setSaveState({ status: "idle" }); setNotice(""); change();
  }
  function open(template: LibraryTemplate, version: LibraryVersion, mode: "metadata" | "version" | "copy") {
    edit(() => { setEditorRevision(v => v + 1); setEditor({ template, version, mode }); setMetadata({ ...template.metadata, title: mode === "copy" ? `${template.metadata.title.slice(0, 95)} 복사` : template.metadata.title });
      setRecipe(structuredClone(version.recipe)); setTab("sources"); });
  }
  function setSelected(ids: string[]) {
    const previous = new Map(recipe.scopes.map(s => [s.id, s]));
    const current = new Map(catalog.scopes.map(s => [s.id, s]));
    const scopes = ids.flatMap(id => { const s = previous.get(id) ?? current.get(id); return s ? [{ id: s.id, version: s.version }] : []; });
    const reachable = new Set(scopes.flatMap(s => current.get(s.id)?.occurrences.map(r => r.key) ?? []));
    setRecipe(r => ({ ...r, scopes, scopeStatus: scopes.length ? "confirmed" : r.scopeStatus,
      excludedOccurrenceKeys: r.excludedOccurrenceKeys.filter(key => reachable.has(key)) }));
  }
  async function save(override?: LibraryCommand) {
    if (saving.current) return;
    if (confirmedBook.current) {
      saving.current = true;
      try { await onSaved?.(confirmedBook.current); confirmedBook.current = null; setSaveState({ status: "idle" }); }
      catch { setSaveState({ status: "error", uncertain: true, error: "단어장은 저장됐습니다. 다시 눌러 시험 설정에 연결해 주세요." }); }
      finally { saving.current = false; }
      return;
    }
    const requestId = crypto.randomUUID();
    let raw: unknown;
    if (pending.current) raw = pending.current;
    else if (override) raw = override;
    else if (editor.mode === "metadata" && editor.template) raw = { action: "metadata", requestId, templateId: editor.template.id, expectedRevision: editor.template.revision, metadata };
    else if (editor.mode === "version" && editor.template && editor.version) raw = { action: "version", requestId, templateId: editor.template.id, expectedRevision: editor.template.revision, expectedContentHash: latestLibraryVersion(editor.template).contentHash, recipe };
    else if (editor.mode === "copy" && editor.version) raw = { action: "copy", requestId, sourceVersionId: editor.version.id, metadata };
    else raw = { action: "create", requestId, metadata, recipe };
    const parsed = libraryCommandSchema.safeParse(raw);
    if (!parsed.success || (!pending.current && ["create", "version"].includes(parsed.data.action) && selection.error)) {
      setSaveState({ status: "error", error: "이름과 선택한 범위를 확인해 주세요." }); return;
    }
    if (!pending.current) pendingAdministrator.current = catalog.viewerId;
    pending.current = parsed.data; saving.current = true; const wasUncertain = Boolean(saveState.uncertain);
    const reportAuth = captureAuthenticationFailure?.(); setSaveState({ status: "saving" });
    try {
      const result = await sendLibraryCommand(parsed.data);
      if (mounted.current) {
        // A read begun before this save cannot replace the confirmed result.
        requestEpoch.current++; setCatalog(c => ({ ...c, templates: [result.template, ...c.templates.filter(t => t.id !== result.template.id)] }));
        setLoadState("ready"); setEditorRevision(v => v + 1);
        setEditor({ mode: "metadata", template: result.template, version: latestLibraryVersion(result.template) });
        setMetadata(result.template.metadata); setRecipe(latestLibraryVersion(result.template).recipe);
        setSaveState({ status: "idle" }); pending.current = null; pendingAdministrator.current = null; setTab("saved");
        if (result.createdBook) {
          const available = result.createdBook.dataset.status === "ready" && result.createdBook.dataset.isActive && result.createdBook.dataset.isAssignable && result.createdBook.dataset.availableQuestionModes.length > 0;
          setNotice(available ? "단어장을 만들었습니다. 시험 범위와 문항 수를 설정해 주세요." : "단어장을 저장했습니다. 현재 출제 가능한 문제가 부족해 배정할 수 없습니다.");
          if (available) {
            confirmedBook.current = result.createdBook;
            try { await onSaved?.(result.createdBook); confirmedBook.current = null; }
            catch { setSaveState({ status: "error", uncertain: true, error: "단어장은 저장됐습니다. 다시 눌러 시험 설정에 연결해 주세요." }); }
          }
        } else setNotice("템플릿을 저장했습니다.");
      }
    } catch (error) {
      if (mounted.current) {
        const auth = error instanceof LibraryRequestError && [401, 403].includes(error.status);
        const definitive = error instanceof LibraryRequestError && [400, 401, 403, 404, 409, 422].includes(error.status) && !(wasUncertain && auth);
        if (definitive) { pending.current = null; pendingAdministrator.current = null; }
        if (auth) { requestEpoch.current++; setAuthenticationFailed(true); setLoadState("error"); setCatalog(c => ({ viewerId: c.viewerId, scopes: [], templates: [] })); }
        reportAuth?.(error);
        setSaveState({ status: "error", uncertain: !definitive, error: error instanceof LibraryRequestError ? error.message : "저장 결과를 확인하지 못했습니다. 같은 내용으로 다시 확인해 주세요." });
      }
    } finally { saving.current = false; }
  }
  return { catalog, loadState, loadError, tab, search, editor, editorRevision, metadata, recipe, saveState, notice, authenticationFailed, differentAdministrator, locked, scopesLocked, visible, templates, selection, difference, conflictingTemplate,
    actions: {
      setTab: (value: "saved" | "sources") => { if (!locked) setTab(value); }, setSearch,
      setMetadata: (value: TemplateMetadata) => edit(() => setMetadata(value)),
      setFilters: (filters: LibraryFilters) => { if (!scopesLocked) edit(() => setRecipe(r => ({ ...r, filters }))); },
      setScopeStatus: (scopeStatus: LibraryRecipe["scopeStatus"]) => { if (!scopesLocked) edit(() => setRecipe(r => scopeStatus === "unconfirmed" ? { ...r, scopeStatus, scopes: [], excludedOccurrenceKeys: [] } : { ...r, scopeStatus })); },
      toggle: (id: string) => { if (!scopesLocked) edit(() => { const s = catalog.scopes.find(s => s.id === id); const ids = recipe.scopes.map(s => s.id);
        if (ids.includes(id) || s?.availability === "available") setSelected(changeVisibleSelection(ids, [id], !ids.includes(id))); }); },
      toggleVisible: (include: boolean) => { if (!scopesLocked) edit(() => setSelected(changeVisibleSelection(recipe.scopes.map(s => s.id), visible.filter(s => s.availability === "available").map(s => s.id), include))); },
      clear: () => { if (!scopesLocked) edit(() => setSelected([])); },
      move: (id: string, offset: -1 | 1) => { if (!scopesLocked) edit(() => { const ids = recipe.scopes.map(s => s.id), from = ids.indexOf(id), to = from + offset;
        if (from >= 0 && to >= 0 && to < ids.length) { [ids[from], ids[to]] = [ids[to]!, ids[from]!]; setSelected(ids); } }); },
      exclude: (key: string) => { if (!scopesLocked) edit(() => setRecipe(r => ({ ...r, excludedOccurrenceKeys: changeVisibleSelection(r.excludedOccurrenceKeys, [key], !r.excludedOccurrenceKeys.includes(key)) }))); },
      newTemplate: () => edit(() => { setEditorRevision(v => v + 1); setEditor({ mode: "create" }); setMetadata(emptyMetadata()); setRecipe(emptyRecipe()); setTab("sources"); }),
      open,
      rebase: () => { if (conflictingTemplate) edit(() => { setEditor(e => ({ ...e, template: conflictingTemplate, version: latestLibraryVersion(conflictingTemplate) }));
        setNotice("최신 버전을 기준으로 변경 내용을 다시 확인해 주세요."); }); },
      reload: () => { if (!locked) { setLoadState("loading"); setReload(v => v + 1); } },
      reauthenticate: () => { if (!saving.current) { setLoadState("loading"); setReload(v => v + 1); } },
      save,
      materialize: (template: LibraryTemplate, version: LibraryVersion) => { if (!locked && !saving.current) void save({ action: "materialize", requestId: crypto.randomUUID(), templateId: template.id, versionId: version.id, contentHash: version.contentHash }); },
    },
  };
}
