"use client";

import { useEffect, useRef, useState } from "react";
import { Button } from "@/design-system/primitives/button/button";
import { Field, FieldError, FieldHelp, FieldLabel, Input } from "@/design-system/primitives/form/field";
import { libraryFiltersSchema, type LibraryTemplate, type LibraryVersion, type CreatedLibraryBook, type LibraryScope, type TemplateMetadata } from "../contracts/library";
import { useWordbookLibrary } from "../client/controllers/use-wordbook-library";
import { latestLibraryVersion } from "../domain/template-version";
import { LibrarySourceFilters } from "./library-source-filters";
import { LIBRARY_KINDS, LIBRARY_KIND_LABELS, libraryAutomaticTags, libraryScopeLabel, needsBook } from "../domain/library-editor";
import { LibraryDiscardDialog, LibraryTargetFields } from "./library-editor-fields";
import styles from "./wordbook-library.module.css";

function SelectedWords({ rows, excluded, onToggle, disabled }: { rows: LibraryScope["occurrences"]; excluded: string[]; onToggle: (key: string) => void; disabled: boolean }) {
  const [query, setQuery] = useState(""), [page, setPage] = useState(0);
  const filtered = rows.filter(row => `${row.headword ?? ""} ${row.meaning ?? ""} ${row.sourceRow}`.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase()));
  const current = Math.min(page, Math.max(0, Math.ceil(filtered.length / 100) - 1));
  return <details><summary>단어별 포함·제외</summary>
    <Input aria-label="담은 단어에서 찾기" value={query} disabled={disabled} onChange={e => { setQuery(e.target.value); setPage(0); }} placeholder="단어 또는 뜻" />
    <div className={styles.scopeList}>{filtered.slice(current * 100, (current + 1) * 100).map(row => <label key={row.key} className={styles.scope}>
      <input type="checkbox" checked={row.state === "included" && !excluded.includes(row.key)} disabled={disabled || row.state !== "included"} onChange={() => onToggle(row.key)} />
      <span>{row.headword ?? `원자료 ${row.sourceRow}번`}<small>{row.meaning ?? ""}{row.state === "held" ? " · 검토 대기" : row.state === "excluded" ? " · 출제 제외 자료" : ""}</small></span>
    </label>)}</div>
    <div className={styles.buttons}><Button size="small" disabled={current === 0} onClick={() => setPage(current - 1)}>이전 단어</Button>
      <span>{filtered.length}개 중 {filtered.length ? current * 100 + 1 : 0}–{Math.min((current + 1) * 100, filtered.length)}</span>
      <Button size="small" disabled={(current + 1) * 100 >= filtered.length} onClick={() => setPage(current + 1)}>다음 단어</Button></div>
  </details>;
}


function TemplateCard({ template, scopes, disabled, onOpen, onUse }: {
  template: LibraryTemplate; scopes: LibraryScope[]; disabled: boolean;
  onOpen: (t: LibraryTemplate, v: LibraryVersion, mode: "metadata" | "version" | "copy") => void;
  onUse: (t: LibraryTemplate, v: LibraryVersion) => void;
}) {
  const [versionId, setVersionId] = useState<string | null>(null);
  const version = template.versions.find(v => v.id === versionId) ?? latestLibraryVersion(template);
  const empty = version.recipe.scopeStatus === "confirmed" && !version.includedKeys.length;
  const tags = libraryAutomaticTags(scopes, version.recipe, template.metadata);
  return <article className={styles.card}>
    <h4>{template.metadata.title}</h4>
    <p aria-label="이 버전의 자동 태그">{tags.map(tag => <span className={styles.tag} key={tag}>{tag}</span>)}</p>
    <label>저장 버전 <select aria-label={`${template.metadata.title} 저장 버전`} value={version.id} disabled={disabled} onChange={e => setVersionId(e.target.value)}>
      {template.versions.map(v => <option key={v.id} value={v.id}>{v.number}판 · 포함 {v.includedKeys.length}개</option>)}
    </select></label>
    <p>{version.recipe.scopeStatus === "unconfirmed" ? "시험 범위가 아직 정해지지 않았습니다." : `범위 ${version.recipe.scopes.length}개 · 원자료 ${version.sourceCount}개 · 포함 ${version.includedKeys.length}개`}</p>
    {empty ? <FieldError>저장된 범위에 포함할 단어가 없습니다. ‘범위 바꾸기’에서 범위를 먼저 정해 주세요.</FieldError> : null}
    <div className={styles.buttons}>
      <Button size="small" disabled={disabled} onClick={() => onOpen(template, latestLibraryVersion(template), "metadata")}>이름·대상 수정</Button>
      <Button size="small" disabled={disabled} onClick={() => onOpen(template, version, "version")}>범위 바꾸기</Button>
      <Button size="small" disabled={disabled || empty} onClick={() => onOpen(template, version, "copy")}>복사</Button>
      <Button size="small" disabled={disabled || version.recipe.scopeStatus === "unconfirmed" || empty} onClick={() => onUse(template, version)}>
        {version.datasetId ? "이 단어장 사용" : "이 범위로 단어장 만들기"}
      </Button>
    </div>
  </article>;
}

export function WordbookLibrary({ onBack, onLockChange, onDirtyChange, captureAuthenticationFailure, onSaved, active = true, initialTarget }: {
  onBack: () => void; onLockChange?: (locked: boolean) => void; onDirtyChange?: (dirty: boolean) => void; captureAuthenticationFailure?: () => (error: unknown) => void;
  onSaved?: (book: CreatedLibraryBook) => void; active?: boolean;
  initialTarget?: Pick<TemplateMetadata, "school" | "targetGrade" | "semester" | "schoolYear">;
}) {
  const c = useWordbookLibrary(captureAuthenticationFailure, onSaved, initialTarget);
  const heading = useRef<HTMLHeadingElement>(null), form = useRef<HTMLDivElement>(null), transition = useRef<(() => void) | null>(null);
  const [discard, setDiscard] = useState(false);
  useEffect(() => { if (active) heading.current?.focus(); }, [active]);
  useEffect(() => { onLockChange?.(c.locked); }, [c.locked, onLockChange]);
  useEffect(() => { onDirtyChange?.(c.dirty); }, [c.dirty, onDirtyChange]);
  const navigate = (action: () => void) => { if (c.dirty) { transition.current = action; setDiscard(true); } else action(); };
  const selected = c.recipe.scopes.map(s => s.id), groupSelected = c.activeGroup?.scopes.map(s => s.id) ?? [];
  const allVisible = !!c.visible.length && c.visible.every(s => groupSelected.includes(s.id));
  const filtersValid = !c.activeGroup || libraryFiltersSchema.safeParse(c.activeGroup.filters).success;
  const summary = c.selection.result;
  const focusError = () => {
    const first = form.current?.querySelector<HTMLElement>('input[aria-invalid="true"], select[aria-invalid="true"], [data-range-error="true"]');
    first?.focus(); first?.scrollIntoView({ block: "nearest" });
  };
  if (c.authenticationFailed) return <section className={styles.library}><p role="alert">관리자 로그인이 필요합니다.</p>
    {c.differentAdministrator ? <p>처음 저장한 관리자 계정으로 로그인한 뒤 결과를 확인해 주세요.</p> : null}
    <Button disabled={c.loadState === "loading"} onClick={c.actions.reauthenticate}>로그인 후 다시 확인</Button>
    {c.loadState === "loading" ? <p role="status">로그인 상태를 확인하는 중…</p> : null}</section>;
  return <section className={styles.library} aria-label="단어장과 템플릿">
    <h3 tabIndex={-1} ref={heading}>단어장과 템플릿</h3>
    <div className={styles.buttons}>
      <Button variant="filter" aria-pressed={c.tab === "saved"} disabled={c.locked} onClick={() => c.actions.setTab("saved")}>저장한 템플릿 찾기</Button>
      <Button variant="filter" aria-pressed={c.tab === "sources" && c.editor.mode === "create"} disabled={c.locked || c.loadState !== "ready"} onClick={() => navigate(c.actions.newTemplate)}>범위로 새로 만들기</Button>
    </div>
    {c.loadState === "loading" ? <p role="status">자료를 불러오는 중…</p> : c.loadState === "error" ? <div role="alert"><p>{c.loadError}</p><Button disabled={c.locked} onClick={c.actions.reload}>다시 불러오기</Button></div> : null}
    {c.notice ? <p role="status">{c.notice}</p> : null}
    {c.tab === "saved" ? <>
      {c.dirty ? <Button disabled={c.locked} onClick={() => c.actions.setTab("sources")}>작성 중인 구성 이어가기</Button> : null}
      <Field><FieldLabel htmlFor="library-template-search">템플릿 검색</FieldLabel><Input id="library-template-search" value={c.search} disabled={c.locked} onChange={e => c.actions.setSearch(e.target.value)} placeholder="이름, 학교, 학기, 시험, 자동 태그" /></Field>
      {c.loadState === "ready" && !c.templates.length ? <p role="status">이 조건에 맞는 자료가 없습니다.</p> : null}
      {c.loadState === "ready" ? <div className={styles.cards}>{c.templates.map(t => <TemplateCard key={t.id} template={t} scopes={c.catalog.scopes} disabled={c.locked}
        onOpen={(template, version, mode) => navigate(() => c.actions.open(template, version, mode))} onUse={(template, version) => navigate(() => c.actions.materialize(template, version))} />)}</div> : null}
      {c.saveState.status === "saving" ? <p role="status">단어장과 문제를 준비하는 중…</p> : null}
      {c.saveState.uncertain ? <Button onClick={() => void c.actions.save()}>같은 내용으로 저장 확인</Button> : null}
    </> : <div ref={form} className={styles.editor}>
      <h4>{({ create: "새 템플릿", metadata: "이름·대상 수정", version: "범위를 바꿔 새 버전 저장", copy: "선택한 버전 복사" })[c.editor.mode]}</h4>
      <section className={styles.step} aria-label="1. 용도와 대상"><h4><span className={styles.stepNumber}>1</span> 용도와 대상</h4>
        <LibraryTargetFields value={c.metadata} onChange={c.actions.setMetadata} disabled={c.locked} errors={c.errors} />
      </section>
      <section className={styles.step} aria-label="2. 자료와 범위" data-range-error={!!c.errors.range} tabIndex={-1} aria-describedby={c.errors.range ? "library-range-error" : undefined}>
        <h4><span className={styles.stepNumber}>2</span> 자료와 범위</h4>
        {c.editor.mode === "metadata" || c.editor.mode === "copy" ? <p className={styles.hint}>이 화면에서는 선택한 버전의 범위를 그대로 사용합니다. 범위는 저장 목록의 ‘범위 바꾸기’에서 수정할 수 있습니다.</p> : <>
          <p className={styles.hint}>종류를 고른 뒤 조건을 바꾸면 해당 묶음의 범위가 바로 바뀝니다. 다른 자료는 새 묶음으로 추가하세요.</p>
          <div className={styles.buttons} aria-label="자료 묶음 추가">{LIBRARY_KINDS.map(kind => <Button key={kind} size="small" disabled={c.scopesLocked || c.loadState !== "ready" || !c.catalog.scopes.some(s => s.classification.kind === kind)} onClick={() => c.actions.addGroup(kind)}>{LIBRARY_KIND_LABELS[kind]} 추가</Button>)}</div>
          {!selected.length && c.editor.version && c.recipe.filters.kinds.length ? <Button disabled={c.scopesLocked} onClick={c.actions.restoreConditions}>저장된 조건으로 범위 채우기</Button> : null}
          <label className={styles.hint}><input type="checkbox" checked={c.recipe.scopeStatus === "unconfirmed"} disabled={c.scopesLocked} onChange={e => c.actions.setScopeStatus(e.target.checked ? "unconfirmed" : "confirmed")} /> 범위를 나중에 정할 예정입니다</label>
          {c.groups.length ? <div className={styles.groupList} aria-label="구성한 자료 묶음">{c.groups.map((g, i) => <div className={styles.groupRow} key={g.id}>
            <Button size="small" variant="filter" aria-pressed={c.activeGroup?.id === g.id} disabled={c.scopesLocked} onClick={() => c.actions.selectGroup(g.id)}>{i + 1}. {LIBRARY_KIND_LABELS[g.kind]} · {g.scopes.length}개 범위</Button>
            <Button size="small" disabled={c.scopesLocked} aria-label={`${i + 1}번 자료 묶음 빼기`} onClick={() => c.actions.removeGroup(g.id)}>묶음 빼기</Button>
          </div>)}</div> : null}
          {c.activeGroup ? <div className={styles.groupEditor}>
            <strong>편집 중: {LIBRARY_KIND_LABELS[c.activeGroup.kind]}</strong>
            {c.activeGroup.manual ? <p className={styles.hint}>개별 선택 범위입니다. 아래 조건을 바꾸면 이 묶음의 범위를 조건에 맞게 다시 고릅니다.</p> : null}
            <LibrarySourceFilters scopes={c.catalog.scopes} group={c.activeGroup} onChange={c.actions.setFilters} onDatasetChange={c.actions.setDataset} disabled={c.scopesLocked} />
            {filtersValid && c.loadState === "ready" && (!needsBook(c.activeGroup.kind) || c.activeGroup.datasetId) ? <>
              <div className={styles.buttons}><strong aria-live="polite">이 묶음에 포함 {groupSelected.length}개 범위</strong><Button size="small" disabled={c.scopesLocked || !c.visible.length} onClick={() => c.actions.toggleVisible(!allVisible)}>{allVisible ? "이 목록 모두 해제" : "이 목록 모두 포함"}</Button></div>
              {!c.visible.length ? <p role="status">이 조건에 맞는 등록 자료가 없습니다. 연도·유형 또는 자료 범위를 확인해 주세요.</p> : <details><summary>세부 범위 확인·제외 ({c.visible.length}개)</summary><div className={styles.scopeList}>{c.visible.map(scope => <label key={scope.id} className={styles.scope}>
                <input type="checkbox" checked={groupSelected.includes(scope.id)} disabled={c.scopesLocked} onChange={() => c.actions.toggle(scope.id)} />
                <span><strong>{libraryScopeLabel(scope)}</strong><small>{scope.classification.kind === "csat" ? "수능 원자료" : scope.sourceTitle} · 포함 {scope.occurrences.filter(r => r.state === "included").length}개</small></span>
              </label>)}</div></details>}
            </> : null}
          </div> : null}
        </>}
        {c.errors.range ? c.dirty || c.editor.mode !== "create" ? <FieldError id="library-range-error">{c.errors.range}</FieldError> : <FieldHelp id="library-range-error">{c.errors.range}</FieldHelp> : null}
      </section>
      <section className={styles.step} aria-label="3. 전체 확인과 저장"><h4><span className={styles.stepNumber}>3</span> 전체 확인과 저장</h4>
        <div className={styles.summary} aria-live="polite">
          <strong>담은 범위 {selected.length}개{summary ? ` · 원자료 ${summary.sourceCount}개 · 포함 ${summary.includedCount}개` : ""}</strong>
          {c.recipe.scopeStatus === "unconfirmed" ? <p>범위 미정으로 저장합니다. 범위를 정한 뒤 단어장을 만들 수 있습니다.</p> : null}
          {summary && (summary.heldCount || summary.excludedCount) ? <p>보류 {summary.heldCount}개 · 제외 {summary.excludedCount}개</p> : null}
          {c.difference ? <p>이전 버전과 비교: 추가 {c.difference.added.length}개 · 빠짐 {c.difference.removed.length}개{c.difference.orderChanged ? " · 순서 변경" : ""}</p> : null}
          <p className={styles.hint}>출처별 포함 수입니다. 실제 시험 문항 수는 사용할 방향과 범위를 확인한 뒤 정해집니다.</p>
          {summary?.occurrences.length ? <SelectedWords key={c.editorRevision} rows={summary.occurrences} excluded={c.recipe.excludedOccurrenceKeys} onToggle={c.actions.exclude} disabled={c.scopesLocked} /> : null}
          {selected.length ? <details><summary>전체 범위와 순서 보기</summary>{c.recipe.scopes.map((s, i) => {
            const scope = c.catalog.scopes.find(x => x.id === s.id);
            return <div key={s.id} className={styles.selectedRow}><span>{scope ? libraryScopeLabel(scope) : "현재 목록에 없는 이전 범위"}</span><div className={styles.buttons}>
              <Button size="small" disabled={c.scopesLocked || i === 0} onClick={() => c.actions.move(s.id, -1)}>위로</Button>
              <Button size="small" disabled={c.scopesLocked || i === selected.length - 1} onClick={() => c.actions.move(s.id, 1)}>아래로</Button>
              <Button size="small" disabled={c.scopesLocked} onClick={() => c.actions.removeScope(s.id)}>빼기</Button>
            </div></div>;
          })}</details> : null}
        </div>
        <div><strong>자동 태그</strong><p className={styles.hint}>실제 포함 범위와 용도·대상에서 만들어집니다.</p><p aria-label="자동 태그">{c.automaticTags.map(tag => <span className={styles.tag} key={tag}>{tag}</span>)}</p>
          {c.legacyTags.length > 0 ? <p aria-label="기존 태그">기존 태그: {c.legacyTags.map(tag => <span className={styles.tag} key={tag}>{tag}</span>)}</p> : null}</div>
        <Field><FieldLabel htmlFor="library-title">템플릿 이름</FieldLabel><Input id="library-title" value={c.metadata.title} maxLength={100} disabled={c.locked} aria-required="true" aria-invalid={!!c.errors.title && c.dirty} aria-describedby={c.errors.title ? "library-title-error" : "library-title-help"} onChange={e => c.actions.setMetadata({ ...c.metadata, title: e.target.value })} />
          {c.errors.title ? c.dirty ? <FieldError id="library-title-error">{c.errors.title}</FieldError> : <FieldHelp id="library-title-error">범위를 고르면 이름을 제안합니다. 직접 입력해도 됩니다.</FieldHelp> : <FieldHelp id="library-title-help">자동 제안한 이름을 원하는 이름으로 고칠 수 있습니다.</FieldHelp>}
          <Button size="small" disabled={c.locked} onClick={c.actions.suggestTitle}>범위에 맞는 이름 다시 제안</Button>
        </Field>
        {c.conflictingTemplate ? <aside className={styles.summary} aria-label="다른 곳에서 수정한 최신 템플릿"><strong>다른 곳에서 수정한 내용이 있습니다.</strong><p>{c.conflictingTemplate.metadata.title}</p><Button disabled={c.locked} onClick={c.actions.rebase}>현재 입력을 최신 버전에 이어서 검토</Button></aside> : null}
        <div className={styles.buttons}><Button disabled={c.saveState.status === "saving" || (!c.saveState.uncertain && !c.canSave)} onClick={() => void c.actions.save()}>
          {c.saveState.status === "saving" ? "저장 확인 중…" : c.saveState.uncertain ? "같은 내용으로 저장 확인" : c.editor.mode === "version" ? "새 버전 저장" : "템플릿 저장"}
        </Button>{!c.canSave && !c.locked ? <Button size="small" onClick={focusError}>입력 위치 확인</Button> : null}</div>
      </section>
    </div>}
    {c.saveState.error ? <div role="alert"><p>{c.saveState.error}</p>{!c.locked ? <Button onClick={c.actions.reload}>최신 자료 다시 확인</Button> : null}</div> : null}
    <Button disabled={c.locked} onClick={() => navigate(() => { c.actions.newTemplate(); c.actions.setTab("saved"); onBack(); })}>단어장 찾기로 돌아가기</Button>
    {discard ? <LibraryDiscardDialog onCancel={() => { transition.current = null; setDiscard(false); }} onDiscard={() => { const action = transition.current; transition.current = null; setDiscard(false); action?.(); }} /> : null}
  </section>;
}
