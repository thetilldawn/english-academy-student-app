"use client";
import { useEffect, useRef, useState } from "react";
import { Button } from "@/design-system/primitives/button/button";
import { Tabs } from "@/design-system/primitives/tabs/tabs";
import { TEMPLATE_KINDS } from "@/lib/admin/dataset-catalog";
import { DialogBody, DialogFooter, DialogFrame, DialogHeader } from "@/design-system/primitives/dialog/dialog";
import { Field, FieldError, FieldHelp, FieldLabel, Input } from "@/design-system/primitives/form/field";
import { type CreatedLibraryBook, type TemplateMetadata } from "../contracts/library";
import { TEMPLATE_KIND_LABELS, templateKindLabel, type TemplateKind, type TemplateKindFilter, type ClassifiedTemplateSummary as LibraryTemplateSummary } from "../contracts/library-v3";
import { useWordbookLibrary } from "../client/controllers/use-wordbook-library";
import { LIBRARY_KINDS, LIBRARY_KIND_LABELS } from "../domain/library-editor";
import { LibraryDiscardDialog, LibraryTargetFields } from "./library-editor-fields";
import { LibraryPageStatus, LibraryQuantitySummary, LibraryRangePanel, LibrarySelectedDetails, LibraryTemplateCard } from "./library-query-panels";
import styles from "./wordbook-library.module.css";

function DeleteTemplateDialog({ template, onCancel, onDelete }: { template: LibraryTemplateSummary; onCancel: () => void; onDelete: () => void }) {
  const cancel = useRef<HTMLButtonElement>(null);
  useEffect(() => { cancel.current?.focus({ preventScroll: true }); }, []);
  return <DialogFrame role="alertdialog" size="compact" layout="body-footer" aria-labelledby="library-delete-title" aria-describedby="library-delete-description" onRequestClose={onCancel}>
    <DialogHeader closeLabel="취소" showCloseButton={false}><h2 id="library-delete-title">템플릿을 삭제할까요?</h2></DialogHeader>
    <DialogBody><p>{template.metadata.title}</p><p id="library-delete-description">템플릿을 삭제해도 이미 만든 단어장과 학생 시험은 유지됩니다.</p></DialogBody>
    <DialogFooter><Button ref={cancel} onClick={onCancel}>취소</Button><Button variant="danger" onClick={onDelete}>이 템플릿 삭제</Button></DialogFooter>
  </DialogFrame>;
}

export function WordbookLibrary({ onBack, onLockChange, onDirtyChange, captureAuthenticationFailure, onSaved, onLibraryChanged, active = true, enabled = true, initialTarget }: {
  onBack: () => void; onLockChange?: (locked: boolean) => void; onDirtyChange?: (dirty: boolean) => void; captureAuthenticationFailure?: () => (error: unknown) => void;
  onSaved?: (book: CreatedLibraryBook) => void; active?: boolean; enabled?: boolean; initialTarget?: Pick<TemplateMetadata, "school" | "targetGrade" | "semester" | "schoolYear">;
  onLibraryChanged?: () => Promise<void> | void;
}) {
  const c = useWordbookLibrary(captureAuthenticationFailure, onSaved, initialTarget, enabled, onLibraryChanged);
  const heading = useRef<HTMLHeadingElement>(null), form = useRef<HTMLDivElement>(null), transition = useRef<(() => void) | null>(null);
  const [discard, setDiscard] = useState(false), [deleting, setDeleting] = useState<LibraryTemplateSummary | null>(null);
  useEffect(() => { if (active && enabled) heading.current?.focus(); }, [active, enabled]);
  useEffect(() => { onLockChange?.(active && c.locked); }, [active, c.locked, onLockChange]);
  useEffect(() => { onDirtyChange?.(c.dirty); }, [c.dirty, onDirtyChange]);
  const navigate = (action: () => void) => { if (c.dirty) { transition.current = action; setDiscard(true); } else action(); };
  const summary = c.preview.data, rangeLocked = ["metadata", "copy", "summary"].includes(c.editor.mode), fixed = rangeLocked || c.metadataOnly;
  const sourceCount = fixed ? c.editor.detail?.version.sourceCount : summary?.sourceCount;
  const includedCount = fixed ? c.editor.detail?.version.includedCount : summary?.includedCount;
  const scopeCount = fixed ? c.editor.detail?.version.scopeCount : summary?.recipe.scopes.length;
  const focusError = () => {
    const first = c.errors.templateKind ? document.getElementById("library-kind-performance_assessment") : form.current?.querySelector<HTMLElement>('input[aria-invalid="true"], select[aria-invalid="true"], [data-range-error="true"]');
    first?.focus(); first?.scrollIntoView({ block: "nearest" });
  };
  if (c.authenticationFailed) return <section className={styles.library}><p role="alert">관리자 로그인이 필요합니다. 처음 저장한 관리자 계정으로 로그인한 뒤 확인해 주세요.</p>
    <Button disabled={c.templates.status === "loading"} onClick={c.actions.reauthenticate}>로그인 후 다시 확인</Button></section>;
  return <section className={styles.library} aria-label="단어장과 템플릿">
    <h3 tabIndex={-1} ref={heading}>단어장과 템플릿</h3>
    <Tabs<TemplateKind | ""> ariaLabel="만들 단어장 종류" className={styles.kindTabs} value={c.templateKind ?? ""}
      items={TEMPLATE_KINDS.map(kind => ({ value: kind, label: TEMPLATE_KIND_LABELS[kind], id: `library-kind-${kind}`, controls: "library-kind-panel", describedBy: c.errors.templateKind && c.tab === "sources" ? "library-kind-error" : undefined, disabled: c.locked }))}
      onChange={value => { if (value) c.actions.selectTemplateKind(value); }} />
    {c.errors.templateKind && c.tab === "sources" ? <FieldHelp id="library-kind-error">{c.errors.templateKind}</FieldHelp> : null}
    <div className={styles.buttons}>
      <Button variant="filter" aria-pressed={c.tab === "saved"} disabled={c.locked} onClick={() => c.actions.setTab("saved")}>저장한 템플릿 찾기</Button>
      <Button variant="filter" aria-pressed={c.tab === "sources" && c.editor.mode === "create"} disabled={c.locked || !c.viewerId} onClick={() => navigate(c.actions.newTemplate)}>범위로 새로 만들기</Button>
    </div>
    {c.opening ? <p role="status">템플릿을 불러오는 중…</p> : null}{c.openError ? <p role="alert">{c.openError}</p> : null}
    {c.notice ? <p role="status">{c.notice}</p> : null}
    <div id="library-kind-panel" role="tabpanel" aria-label="단어장 구성">
    {c.tab === "saved" ? <>
      {c.dirty ? <Button disabled={c.locked} onClick={() => c.actions.setTab("sources")}>작성 중인 구성 이어가기</Button> : null}
      <Field><FieldLabel htmlFor="library-template-search">템플릿 검색</FieldLabel><Input id="library-template-search" value={c.search} disabled={c.locked} onChange={e => c.actions.setSearch(e.target.value)} placeholder="이름, 학교, 학기, 시험, 자동 태그" /></Field>
      <Field><FieldLabel htmlFor="library-kind-filter">저장한 구성의 종류</FieldLabel><select id="library-kind-filter" value={c.savedKindFilter} disabled={c.locked} onChange={e => c.actions.setSavedKindFilter(e.target.value as TemplateKindFilter)}>
        <option value="all">전체</option>{TEMPLATE_KINDS.map(kind => <option key={kind} value={kind}>{TEMPLATE_KIND_LABELS[kind]}</option>)}<option value="unclassified">분류 확인</option>
      </select></Field>
      <LibraryPageStatus page={c.templates} />
      {c.templates.status === "ready" && !c.templates.data?.items.length ? <p>이 조건에 맞는 템플릿이 없습니다.</p> : null}
      <div className={styles.cards}>{c.templates.data?.items.map(t => <LibraryTemplateCard key={t.id} template={t} c={c} navigate={navigate} onDelete={() => navigate(() => setDeleting(t))} />)}</div>
      {c.templates.data?.nextCursor ? <Button disabled={c.templates.status !== "ready" || c.locked} onClick={c.templates.more}>템플릿 20개 더 보기</Button> : null}
      {c.saveState.status === "saving" ? <p role="status">요청한 내용을 저장하는 중…</p> : null}
      {c.saveState.uncertain ? <Button onClick={c.actions.save}>같은 내용으로 저장 확인</Button> : null}
    </> : <div ref={form} className={styles.editor}>
      <h4>{({ create: "새 템플릿", summary: "저장한 구성", metadata: "이름·종류·대상 수정", version: "범위를 바꿔 새 버전 저장", copy: "선택한 버전 복사", use: "조건을 확인해 단어장 만들기" })[c.editor.mode]}</h4>
      <p>{templateKindLabel(c.templateKind)}{c.editor.detail ? ` · 선택한 ${c.editor.detail.version.number}판` : ""}</p>
      {c.editor.mode === "summary" ? <div className={styles.buttons}><Button onClick={() => c.actions.editSummary("metadata")}>이름·종류 수정</Button><Button onClick={() => c.actions.editSummary("version")}>범위 수정</Button>
        <Button disabled={c.editor.detail?.version.scopeStatus === "unconfirmed" || !c.editor.detail?.version.includedCount} onClick={() => c.actions.editSummary("use")}>이 범위 사용</Button></div> : null}
      <section className={styles.step} aria-label="1. 용도와 대상"><h4><span className={styles.stepNumber}>1</span> 용도와 대상</h4>
        <LibraryTargetFields value={c.metadata} templateKind={c.templateKind} onChange={c.actions.setMetadata} disabled={c.locked || c.editor.mode === "summary"} errors={c.errors} />
      </section>
      <section className={styles.step} aria-label="2. 자료와 범위" data-range-error={!!c.errors.range} tabIndex={-1} aria-describedby={c.errors.range ? "library-range-error" : undefined}>
        <h4><span className={styles.stepNumber}>2</span> 자료와 범위</h4>
        {rangeLocked ? <p className={styles.hint}>선택한 버전의 범위를 그대로 사용합니다. 범위는 ‘범위 바꾸기’에서 수정할 수 있습니다.</p> : <>
          <p className={styles.hint}>자료를 추가하면 범위를 정할 수 있습니다. 다른 종류의 자료도 함께 담을 수 있습니다.</p>
          <div className={styles.buttons} aria-label="자료 묶음 추가">{LIBRARY_KINDS.map(kind => <Button key={kind} size="small" disabled={c.scopesLocked} onClick={() => c.actions.addGroup(kind)}>{LIBRARY_KIND_LABELS[kind]} 추가</Button>)}</div>
          <label className={styles.hint}><input type="checkbox" checked={c.criteria.scopeStatus === "unconfirmed"} disabled={c.scopesLocked || c.editor.mode === "use"} onChange={e => c.actions.setScopeStatus(e.target.checked ? "unconfirmed" : "confirmed")} /> 범위를 나중에 정할 예정입니다</label>
          <div className={styles.groupList} aria-label="구성한 자료 묶음">{c.criteria.groups.map((g, i) => <div className={styles.groupRow} key={g.id}>
            <Button size="small" variant="filter" aria-pressed={c.activeGroup?.id === g.id} disabled={c.scopesLocked} onClick={() => c.actions.selectGroup(g.id)}>{i + 1}. {g.mode === "fixed" ? "저장된 개별 범위" : LIBRARY_KIND_LABELS[g.kind]}{summary ? ` · ${summary.groups.find(r => r.id === g.id)?.scopes.length ?? g.scopes.length}개 범위` : ""}</Button>
            <Button size="small" disabled={c.scopesLocked} aria-label={`${i + 1}번 자료 묶음 빼기`} onClick={() => c.actions.removeGroup(g.id)}>묶음 빼기</Button>
          </div>)}</div>
          {c.activeGroup ? <LibraryRangePanel key={`${c.editorRevision}:${c.activeGroup.id}`} c={c} /> : null}
        </>}
        {c.errors.range ? c.dirty || c.editor.mode !== "create" ? <FieldError id="library-range-error">{c.errors.range}</FieldError> : <FieldHelp id="library-range-error">{c.errors.range}</FieldHelp> : null}
      </section>
      <section className={styles.step} aria-label="3. 전체 확인과 저장"><h4><span className={styles.stepNumber}>3</span> 전체 확인과 저장</h4>
        {!fixed ? <LibraryPageStatus page={c.preview} /> : null}
        <div className={styles.summary} aria-live="polite">
          <strong>{scopeCount === undefined ? "담은 범위를 확인하는 중…" : `담은 범위 ${scopeCount}개 · 원자료 항목 ${sourceCount}개 · 포함 항목 ${includedCount}개`}</strong>
          <LibraryQuantitySummary quantities={fixed ? c.editor.detail?.quantities : summary?.quantities} />
          {c.criteria.scopeStatus === "unconfirmed" ? <p>범위 미정으로 저장합니다. 범위를 정한 뒤 단어장을 만들 수 있습니다.</p> : null}
          {!fixed && summary && (summary.heldCount || summary.excludedCount) ? <p>보류 {summary.heldCount}개 · 제외 {summary.excludedCount}개</p> : null}
          {!fixed && summary?.difference ? <p>이전 버전과 비교: 추가 {summary.difference.added}개 · 빠짐 {summary.difference.removed}개 · 범위 추가 {summary.difference.scopeAdded}개 · 범위 빠짐 {summary.difference.scopeRemoved}개{summary.difference.orderChanged ? " · 순서 변경" : ""}</p> : null}
          {!fixed && summary?.orphanedExclusions.length ? <div><p>현재 범위에서 빠진 제외 단어 {summary.orphanedExclusions.length}개</p><Button disabled={c.locked} onClick={c.actions.clearOrphans}>현재 범위에 없는 제외 목록 정리</Button></div> : null}
          {!fixed && c.editor.mode === "use" && summary?.difference?.changed ? <label><input type="checkbox" checked={c.changeConfirmed === summary.contentHash} disabled={c.locked} onChange={e => c.actions.confirmChange(e.target.checked)} /> 조건에 맞는 자료가 달라졌습니다. 변경 내용을 확인하고 새 버전으로 만듭니다.</label> : null}
        </div>
        <LibrarySelectedDetails key={c.editorRevision} c={c} />
        <p aria-label="현재 대상">{c.currentTargetTags.map(tag => <span className={styles.tag} key={tag}>{tag}</span>)}</p>
        <p aria-label="선택한 판의 자료 태그">{c.sourceTags.map(tag => <span className={styles.tag} key={tag}>{tag}</span>)}</p>
        {c.editor.detail?.template.metadata.tags.length ? <details><summary>이전 저장 태그</summary><p className={styles.hint}>{c.editor.detail.template.metadata.tags.join(" · ")}</p></details> : null}
        <Field><FieldLabel htmlFor="library-title">템플릿 이름</FieldLabel><Input id="library-title" value={c.metadata.title} maxLength={100} disabled={c.locked || c.editor.mode === "summary"} aria-required="true" aria-invalid={!!c.errors.title && c.dirty} aria-describedby={c.errors.title ? "library-title-error" : "library-title-help"} onChange={e => c.actions.setMetadata({ ...c.metadata, title: e.target.value })} />
          {c.errors.title ? c.dirty ? <FieldError id="library-title-error">{c.errors.title}</FieldError> : <FieldHelp id="library-title-error">범위를 고르면 이름을 제안합니다. 직접 입력해도 됩니다.</FieldHelp> : <FieldHelp id="library-title-help">자동 제안한 이름을 원하는 이름으로 고칠 수 있습니다.</FieldHelp>}
          <Button size="small" disabled={c.locked || fixed} onClick={c.actions.suggestTitle}>범위에 맞는 이름 다시 제안</Button>
        </Field>
        {c.conflictingDetail ? <aside className={styles.summary} aria-label="다른 곳에서 수정한 최신 템플릿"><strong>다른 곳에서 수정한 내용이 있습니다.</strong><p>{c.conflictingDetail.template.metadata.title}</p><Button disabled={c.locked} onClick={c.actions.rebase}>현재 입력을 최신 버전에 이어서 검토</Button></aside> : null}
        {c.editor.mode !== "summary" || c.saveState.uncertain ? <div className={styles.buttons}><Button disabled={c.saveState.status === "saving" || c.opening || (!c.saveState.uncertain && !c.canSave)} onClick={c.actions.save}>
          {c.saveState.status === "saving" ? "저장 확인 중…" : c.saveState.uncertain ? "같은 내용으로 저장 확인" : c.editor.mode === "use" ? "확인한 범위로 단어장 만들기" : c.editor.mode === "version" && !c.metadataOnly ? "새 버전 저장" : "템플릿 저장"}
        </Button>{!c.canSave && !c.locked ? <Button size="small" onClick={focusError}>입력 위치 확인</Button> : null}</div> : null}
      </section>
    </div>}</div>
    {c.saveState.error ? <div role="alert"><p>{c.saveState.error}</p>{!c.locked ? <Button onClick={c.actions.reload}>최신 자료 다시 확인</Button> : null}</div> : null}
    <Button disabled={c.locked} onClick={() => navigate(() => { c.actions.newTemplate(); c.actions.setTab("saved"); onBack(); })}>단어장 찾기로 돌아가기</Button>
    {discard ? <LibraryDiscardDialog onCancel={() => { transition.current = null; setDiscard(false); }} onDiscard={() => { const action = transition.current; transition.current = null; setDiscard(false); action?.(); }} /> : null}
    {deleting ? <DeleteTemplateDialog template={deleting} onCancel={() => setDeleting(null)} onDelete={() => { c.actions.deleteTemplate(deleting); setDeleting(null); }} /> : null}
  </section>;
}
