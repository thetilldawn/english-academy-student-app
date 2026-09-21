"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { templateMetadataSchema, type CreatedLibraryBook, type LibraryFilters, type TemplateMetadata } from "../../contracts/library";
import { type LibraryCriteria, type LibraryCriteriaGroup, type LibraryDetail, type LibraryScopeHeader, type LibraryTemplateSummary, type LibraryVersionSummary } from "../../contracts/library-query";
import { type LibraryCommandV2 } from "../../contracts/library-command-v2";
import { emptyLibraryCriteria, fixedLibraryCriteria, newCriteriaGroup, toggleCriteriaScope, validLibraryCriteria } from "../../domain/library-criteria";
import { kindFilters, libraryTagsFromClassifications, needsBook, type LibraryKind } from "../../domain/library-editor";
import { LibraryRequestError, readLibraryPage } from "../transport/library-transport";
import { useLibraryPage } from "./use-library-page";
import { useLibraryCommand } from "./use-library-command";

const emptyMetadata = (): TemplateMetadata => ({ title: "", tags: [], school: null, targetGrade: null, schoolYear: null, semester: null, assessment: null, purpose: null });
type Mode = "create" | "metadata" | "version" | "copy" | "use";
export function useWordbookLibrary(captureAuthenticationFailure?: () => (error: unknown) => void, onSaved?: (book: CreatedLibraryBook) => void,
  initialTarget?: Pick<TemplateMetadata, "school" | "targetGrade" | "semester" | "schoolYear">) {
  const [viewerId, setViewerId] = useState<string>();
  const actor = useRef<string | undefined>(undefined), openRequest = useRef<AbortController | null>(null);
  const [authenticationFailed, setAuthenticationFailed] = useState(false);
  const [authRecovering, setAuthRecovering] = useState(false);
  const authGate = useRef({ failed: false, recovering: false });
  const [tab, setTab] = useState<"saved" | "sources">("saved"), [search, setSearch] = useState("");
  const [editor, setEditor] = useState<{ mode: Mode; detail?: LibraryDetail }>({ mode: "create" });
  const [metadataInput, setMetadata] = useState<TemplateMetadata>(() => ({ ...emptyMetadata(), ...initialTarget }));
  const [previousTarget, setPreviousTarget] = useState(initialTarget);
  const [titleEdited, setTitleEdited] = useState(false), [criteria, setCriteria] = useState<LibraryCriteria>(emptyLibraryCriteria);
  const [legacyTags, setLegacyTags] = useState<string[]>([]);
  const [activeGroupId, setActiveGroupId] = useState<string | null>(null), [dirty, setDirty] = useState(false);
  const [notice, setNotice] = useState(""), [opening, setOpening] = useState(false), [openError, setOpenError] = useState("");
  const [changeConfirmed, setChangeConfirmed] = useState<string | null>(null), [editorRevision, setEditorRevision] = useState(0);
  const [conflictingDetail, setConflictingDetail] = useState<LibraryDetail | null>(null);
  useEffect(() => () => openRequest.current?.abort(), []);
  if (JSON.stringify(previousTarget) !== JSON.stringify(initialTarget)) {
    const previous = previousTarget; setPreviousTarget(initialTarget);
    if (editor.mode === "create") setMetadata(current => {
      const next = { ...current };
      for (const key of ["school", "targetGrade", "semester", "schoolYear"] as const) if (current[key] === (previous?.[key] ?? null)) Object.assign(next, { [key]: initialTarget?.[key] ?? null });
      return next;
    });
  }
  const reportError = useCallback((error: unknown) => {
    captureAuthenticationFailure?.()(error);
    if (error instanceof LibraryRequestError && [401, 403].includes(error.status)) {
      authGate.current = { failed: true, recovering: false }; setAuthenticationFailed(true); setAuthRecovering(false); openRequest.current?.abort(); setOpening(false);
    }
  }, [captureAuthenticationFailure]);
  const acceptViewer = useCallback((id: string) => {
    if (authGate.current.failed && !authGate.current.recovering) return;
    if (actor.current && actor.current !== id) { authGate.current = { failed: true, recovering: false }; setAuthenticationFailed(true); setAuthRecovering(false); return; }
    actor.current = id; authGate.current = { failed: false, recovering: false }; setViewerId(id); setAuthenticationFailed(false); setAuthRecovering(false);
  }, []);
  const templates = useLibraryPage(!authenticationFailed || authRecovering ? { kind: "templates", search, cursor: null, limit: 20 } : null, undefined, reportError, acceptViewer);
  const activeGroup = criteria.groups.find(g => g.id === activeGroupId) ?? null;
  const valid = validLibraryCriteria(criteria);
  const [lastValid, setLastValid] = useState(criteria);
  if (valid && JSON.stringify(criteria) !== JSON.stringify(lastValid)) setLastValid(criteria);
  const rangeEditable = editor.mode !== "metadata" && editor.mode !== "copy";
  const normalizedMetadata = { ...metadataInput, school: metadataInput.school?.trim() || null, assessment: metadataInput.assessment?.trim() || null, purpose: metadataInput.purpose?.trim() || null };
  const preview = useLibraryPage(tab === "sources" && viewerId && rangeEditable && !authenticationFailed ? { kind: "preview", selection: { mode: "criteria", criteria: lastValid },
    compareVersionId: editor.detail?.version.id ?? null, metadata: { ...normalizedMetadata, title: metadataInput.title.slice(0, 100) } } : null, viewerId, reportError);
  const shown = preview.data;
  const [lastSuggestedTitle, setLastSuggestedTitle] = useState({ revision: -1, title: "" });
  if (shown && (lastSuggestedTitle.revision !== editorRevision || lastSuggestedTitle.title !== shown.suggestedTitle)) setLastSuggestedTitle({ revision: editorRevision, title: shown.suggestedTitle });
  const metadata: TemplateMetadata = { ...normalizedMetadata,
    title: titleEdited ? metadataInput.title : shown?.suggestedTitle ?? (lastSuggestedTitle.revision === editorRevision ? lastSuggestedTitle.title : ""),
    tags: [...new Set([...legacyTags, ...(shown?.automaticTags ?? [...libraryTagsFromClassifications([], normalizedMetadata), ...(editor.detail?.sourceTags ?? [])])])].slice(0, 30) };
  const errors: Record<string, string> = {};
  const parsedMeta = templateMetadataSchema.safeParse(metadata);
  if (!parsedMeta.success) for (const issue of parsedMeta.error.issues) errors[String(issue.path[0])] = issue.path[0] === "title" ? "템플릿 이름을 입력해 주세요." : issue.path[0] === "schoolYear" ? "시험 준비 연도는 2000~2100년으로 입력해 주세요." : "입력한 내용을 확인해 주세요.";
  if (rangeEditable && criteria.scopeStatus === "confirmed") {
    if (!valid) errors.range = "범위의 시작과 끝을 확인해 주세요.";
    else if (!criteria.groups.length) errors.range = "자료 종류와 범위를 선택해 주세요.";
    else if (criteria.groups.some(g => g.mode === "filter" && needsBook(g.kind) && !g.datasetId)) errors.range = "각 묶음에서 사용할 자료를 선택해 주세요.";
    else if (preview.status === "error") errors.range = preview.error;
    else if (preview.status !== "ready") errors.range = "선택한 범위를 확인하는 중입니다.";
    else if (shown?.groups.some(g => !g.scopes.length)) errors.range = "비어 있는 자료 묶음의 범위를 고르거나 그 묶음을 빼 주세요.";
    else if (!shown?.includedCount) errors.range = "포함할 단어가 없습니다. 범위 또는 단어별 제외를 확인해 주세요.";
    else if (shown.orphanedExclusions.length) errors.range = "이전 제외 단어 중 현재 범위에 없는 단어가 있습니다. 아래에서 제외 목록 정리를 확인해 주세요.";
  }
  if (editor.mode === "copy" && editor.detail?.version.scopeStatus === "confirmed" && !editor.detail.version.includedCount) errors.range = "저장된 범위가 비어 있습니다. 먼저 범위를 수정해 주세요.";
  if (editor.mode === "use" && criteria.scopeStatus !== "confirmed") errors.range = "단어장을 만들려면 사용할 범위를 먼저 확정해 주세요.";
  const mutations = useLibraryCommand(viewerId, result => {
    openRequest.current?.abort();
    templates.reload(); setDirty(false); setTab("saved"); setEditorRevision(n => n + 1);
    setNotice("deleted" in result ? "템플릿을 삭제했습니다. 기존 단어장과 학생 시험은 그대로 유지됩니다." : result.createdBook
      ? result.createdBook.dataset.isAssignable && result.createdBook.dataset.isActive && result.createdBook.dataset.availableQuestionModes.length
        ? "단어장을 만들었습니다. 시험 범위와 문항 수를 설정해 주세요." : "단어장은 저장됐지만 현재 출제 가능한 문제가 부족해 배정할 수 없습니다. 범위를 추가한 뒤 다시 만들어 주세요."
      : "템플릿을 저장했습니다.");
  }, reportError, onSaved);
  const locked = mutations.locked || opening, scopesLocked = locked || !rangeEditable;
  const canSave = !!viewerId && !authenticationFailed && !conflictingDetail && !Object.keys(errors).length && (!rangeEditable || valid && preview.status === "ready")
    && (editor.mode !== "use" || !shown?.difference?.changed || changeConfirmed === shown.contentHash);
  function edit(change: () => void) {
    if (locked) return;
    mutations.reset(); setDirty(true); setNotice(""); setChangeConfirmed(null); change();
  }
  function changeGroup(change: (g: LibraryCriteriaGroup) => LibraryCriteriaGroup) {
    if (!activeGroup || scopesLocked) return;
    edit(() => setCriteria(c => ({ ...c, groups: c.groups.map(g => g.id === activeGroup.id ? change(g) : g) })));
  }
  async function open(template: LibraryTemplateSummary, version: LibraryVersionSummary, mode: Exclude<Mode, "create">) {
    if (locked || !viewerId) return;
    openRequest.current?.abort(); const request = new AbortController(); openRequest.current = request; setOpening(true); setOpenError("");
    try {
      const detail = await readLibraryPage({ kind: "detail", templateId: template.id, versionId: version.id }, request.signal, viewerId);
      if (request.signal.aborted) return;
      const restored = detail.criteria ?? fixedLibraryCriteria(detail.recipe);
      setLegacyTags(detail.template.metadata.tags.filter(t => !detail.automaticTags.includes(t)));
      setEditor({ mode, detail }); setMetadata({ ...detail.template.metadata, title: mode === "copy" ? `${detail.template.metadata.title.slice(0, 95)} 복사` : detail.template.metadata.title });
      setTitleEdited(true); setCriteria(restored); setActiveGroupId(restored.groups[0]?.id ?? null); setDirty(false); setChangeConfirmed(null); setConflictingDetail(null); setTab("sources"); setEditorRevision(n => n + 1); mutations.reset();
    } catch (error) { if (!request.signal.aborted) { reportError(error); setOpenError(error instanceof Error ? error.message : "템플릿을 불러오지 못했습니다."); } }
    finally { if (!request.signal.aborted) setOpening(false); }
  }
  function save() {
    if (mutations.state.uncertain) { void mutations.run(); return; }
    if (!canSave) return;
    const requestId = crypto.randomUUID(), t = editor.detail?.template, v = editor.detail?.version;
    let command: LibraryCommandV2;
    if (editor.mode === "metadata" && t) command = { action: "metadata", requestId, templateId: t.id, expectedRevision: t.revision, metadata };
    else if (editor.mode === "copy" && v) command = { action: "copy", requestId, sourceVersionId: v.id, metadata };
    else if (editor.mode === "use" && t && v && !shown?.difference?.changed && JSON.stringify(metadata) === JSON.stringify(t.metadata)
      && JSON.stringify(criteria) === JSON.stringify(editor.detail?.criteria ?? fixedLibraryCriteria(editor.detail!.recipe))) command = { action: "materialize", requestId, templateId: t.id, versionId: v.id, contentHash: v.contentHash };
    else {
      if (!shown) return;
      const range = { recipe: shown.recipe, criteria, previewHash: shown.contentHash };
      command = editor.mode !== "create" && t ? { action: "version", requestId, templateId: t.id, expectedRevision: t.revision, expectedContentHash: t.latestVersion.contentHash, metadata, ...range }
        : { action: "create", requestId, metadata, ...range };
    }
    void mutations.run(command, editor.mode === "use");
  }
  return { viewerId, reportError, templates, tab, search, editor, editorRevision, metadata, criteria, activeGroup, preview, dirty, errors, canSave,
    authenticationFailed, opening, openError, notice, locked, scopesLocked, saveState: mutations.state, changeConfirmed, conflictingDetail,
    actions: {
      setSearch, setTab: (value: "saved" | "sources") => { if (!locked) setTab(value); }, open, save,
      reload: () => { templates.reload(); preview.reload();
        if (editor.detail && viewerId && !locked) {
          openRequest.current?.abort(); const request = new AbortController(); openRequest.current = request;
          void readLibraryPage({ kind: "detail", templateId: editor.detail.template.id }, request.signal, viewerId).then(detail => {
            if (!request.signal.aborted && detail.template.revision !== editor.detail?.template.revision) setConflictingDetail(detail);
          }).catch(error => { if (!request.signal.aborted) reportError(error); });
        }
      }, reauthenticate: () => { authGate.current.recovering = true; setAuthRecovering(true); templates.reload(); },
      rebase: () => { if (conflictingDetail && editor.mode !== "create" && conflictingDetail.template.id === editor.detail?.template.id) edit(() => { setEditor(e => ({ ...e, detail: conflictingDetail })); setConflictingDetail(null); setNotice("최신 버전을 기준으로 변경 내용을 다시 확인해 주세요."); }); },
      setMetadata: (value: TemplateMetadata) => edit(() => { if (value.title !== metadata.title) setTitleEdited(true); setMetadata(value); }),
      suggestTitle: () => edit(() => setTitleEdited(false)),
      confirmChange: (yes: boolean) => setChangeConfirmed(yes ? shown?.contentHash ?? null : null),
      addGroup: (kind: LibraryKind) => { if (!scopesLocked) edit(() => { const g = newCriteriaGroup(kind, crypto.randomUUID()); setCriteria(c => ({ ...c, scopeStatus: "confirmed", groups: [...c.groups, g] })); setActiveGroupId(g.id); }); },
      selectGroup: (id: string) => { if (!locked) setActiveGroupId(id); },
      removeGroup: (id: string) => { if (!scopesLocked) edit(() => { const groups = criteria.groups.filter(g => g.id !== id); setCriteria(c => ({ ...c, groups })); if (activeGroupId === id) setActiveGroupId(groups[0]?.id ?? null); }); },
      setFilters: (filters: LibraryFilters) => changeGroup(g => { const next = kindFilters(g.kind, filters);
        if (next.yearFrom !== g.filters.yearFrom || next.yearTo !== g.filters.yearTo) next.years = [];
        else if (JSON.stringify(next.years) !== JSON.stringify(g.filters.years)) { next.yearFrom = null; next.yearTo = null; }
        if (JSON.stringify(next.types) !== JSON.stringify(g.filters.types)) next.questions = [];
        return { ...g, mode: "filter", scopes: [], filters: next }; }),
      setDataset: (datasetId: string | null) => changeGroup(g => ({ ...g, datasetId, mode: "filter", scopes: [], excludedScopeKeys: [], filters: kindFilters(g.kind) })),
      setScopeStatus: (scopeStatus: LibraryCriteria["scopeStatus"]) => { if (!scopesLocked) edit(() => { setCriteria(scopeStatus === "unconfirmed" ? { groups: [], excludedOccurrenceKeys: [], scopeStatus } : { ...criteria, scopeStatus }); setActiveGroupId(null); }); },
      toggle: (scope: LibraryScopeHeader, include: boolean) => changeGroup(g => toggleCriteriaScope(g, scope, include)),
      toggleVisible: (scopes: LibraryScopeHeader[], include: boolean) => changeGroup(g => scopes.reduce((value, scope) => toggleCriteriaScope(value, scope, include), g)),
      exclude: (key: string) => { if (!scopesLocked) edit(() => setCriteria(c => ({ ...c, excludedOccurrenceKeys: c.excludedOccurrenceKeys.includes(key) ? c.excludedOccurrenceKeys.filter(k => k !== key) : [...c.excludedOccurrenceKeys, key] }))); },
      clearOrphans: () => edit(() => setCriteria(c => ({ ...c, excludedOccurrenceKeys: c.excludedOccurrenceKeys.filter(k => !shown?.orphanedExclusions.includes(k)) }))),
      move: (id: string, offset: -1 | 1) => { if (!scopesLocked && shown) edit(() => { const refs = [...shown.recipe.scopes], from = refs.findIndex(r => r.id === id), to = from + offset;
        if (from < 0 || to < 0 || to >= refs.length) return; [refs[from], refs[to]] = [refs[to]!, refs[from]!];
        const next = fixedLibraryCriteria({ ...shown.recipe, scopes: refs }); setCriteria(next); setActiveGroupId(next.groups[0]?.id ?? null); }); },
      newTemplate: () => { if (!locked) { openRequest.current?.abort(); mutations.reset(); setEditor({ mode: "create" }); setEditorRevision(n => n + 1); setMetadata({ ...emptyMetadata(), ...initialTarget }); setLegacyTags([]); setTitleEdited(false); setCriteria(emptyLibraryCriteria()); setActiveGroupId(null); setDirty(false); setNotice(""); setTab("sources"); setChangeConfirmed(null); setConflictingDetail(null); } },
      deleteTemplate: (t: LibraryTemplateSummary) => { if (!locked) void mutations.run({ action: "delete", requestId: crypto.randomUUID(), templateId: t.id, expectedRevision: t.revision }); },
      refreshEditor: () => { if (editor.detail) void open(editor.detail.template, editor.detail.version, editor.mode === "create" ? "version" : editor.mode); },
    },
  };
}
