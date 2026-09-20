"use client";

import { useEffect, useRef, useState } from "react";
import { Button } from "@/design-system/primitives/button/button";
import { Field, FieldLabel, Input } from "@/design-system/primitives/form/field";
import { libraryFiltersSchema, type LibraryTemplate, type LibraryVersion, type TemplateMetadata, type CreatedLibraryBook, type LibraryScope } from "../contracts/library";
import { useWordbookLibrary } from "../client/controllers/use-wordbook-library";
import { latestLibraryVersion } from "../domain/template-version";
import { LibrarySourceFilters } from "./library-source-filters";
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

function TemplateCard({ template, disabled, onOpen, onUse }: { template: LibraryTemplate; disabled: boolean;
  onOpen: (template: LibraryTemplate, version: LibraryVersion, mode: "metadata" | "version" | "copy") => void;
  onUse?: (template: LibraryTemplate, version: LibraryVersion) => void;
}) {
  const [versionId, setVersionId] = useState<string | null>(null);
  const version = template.versions.find(v => v.id === versionId) ?? latestLibraryVersion(template), m = template.metadata;
  return <article className={styles.card}>
    <h4>{m.title}</h4><p className={styles.hint}>{[m.school, m.targetGrade && ({ g10: "고1", g11: "고2", g12: "고3" }[m.targetGrade] ?? m.targetGrade),
      m.schoolYear && `${m.schoolYear}년`, m.semester && `${m.semester}학기`, m.assessment, m.purpose].filter(Boolean).join(" · ")}</p>
    {m.tags.length ? <p>{m.tags.map(tag => <span className={styles.tag} key={tag}>{tag}</span>)}</p> : null}
    <label>저장 버전 <select aria-label={`${m.title} 저장 버전`} value={version.id} disabled={disabled} onChange={e => setVersionId(e.target.value)}>
      {template.versions.map(v => <option key={v.id} value={v.id}>{v.number}판 · 포함 {v.includedKeys.length}개</option>)}
    </select></label>
    <p>{version.recipe.scopeStatus === "unconfirmed" ? "시험 범위가 아직 정해지지 않았습니다." : `범위 ${version.recipe.scopes.length}개 · 원자료 ${version.sourceCount}개 · 포함 ${version.includedKeys.length}개`}</p>
    <div className={styles.buttons}>
      <Button size="small" disabled={disabled} onClick={() => onOpen(template, latestLibraryVersion(template), "metadata")}>이름·태그 수정</Button>
      <Button size="small" disabled={disabled} onClick={() => onOpen(template, version, "version")}>범위 바꾸기</Button>
      <Button size="small" disabled={disabled} onClick={() => onOpen(template, version, "copy")}>복사</Button>
      {onUse ? <Button size="small" disabled={disabled || version.recipe.scopeStatus === "unconfirmed" || !version.includedKeys.length}
        onClick={() => onUse(template, version)}>{version.datasetId ? "이 단어장 사용" : "이 범위로 단어장 만들기"}</Button> : null}
    </div>
  </article>;
}

function MetadataFields({ value, onChange, disabled }: { value: TemplateMetadata; onChange: (m: TemplateMetadata) => void; disabled: boolean }) {
  const labels = { school: "학교", targetGrade: "사용 대상 학년", assessment: "시험", purpose: "용도" };
  const [tagText, setTagText] = useState(value.tags.join(", "));
  return <div className={styles.metadata}>
    <Field><FieldLabel htmlFor="library-title">템플릿 이름</FieldLabel><Input id="library-title" value={value.title} maxLength={100} disabled={disabled} onChange={e => onChange({ ...value, title: e.target.value })} /></Field>
    <Field><FieldLabel htmlFor="library-tags">찾기 태그 (쉼표로 구분)</FieldLabel><Input id="library-tags" value={tagText} maxLength={1230} disabled={disabled}
      onChange={e => setTagText(e.target.value)} onBlur={() => onChange({ ...value, tags: [...new Set(tagText.split(",").map(v => v.trim()).filter(Boolean))] })} /></Field>
    {(Object.entries(labels) as [keyof typeof labels, string][]).map(([key, label]) => <Field key={key}><FieldLabel htmlFor={`library-meta-${key}`}>{label}</FieldLabel>
      {key === "targetGrade" ? <select id={`library-meta-${key}`} disabled={disabled} value={value[key] ?? ""} onChange={e => onChange({ ...value, [key]: e.target.value || null })}>
        <option value="">지정 안 함</option>{["g7", "g8", "g9", "g10", "g11", "g12"].map((v, i) => <option key={v} value={v}>{i < 3 ? `중${i + 1}` : `고${i - 2}`}</option>)}
        {value.targetGrade && !["g7", "g8", "g9", "g10", "g11", "g12"].includes(value.targetGrade) ? <option value={value.targetGrade}>{value.targetGrade}</option> : null}
      </select> : <Input id={`library-meta-${key}`} value={value[key] ?? ""} maxLength={240} disabled={disabled} onChange={e => onChange({ ...value, [key]: e.target.value || null })} />}
    </Field>)}
    <Field><FieldLabel htmlFor="library-school-year">시험 준비 연도</FieldLabel><Input id="library-school-year" type="number" min={2000} max={2100} value={value.schoolYear ?? ""} disabled={disabled}
      onChange={e => onChange({ ...value, schoolYear: e.target.value ? Number(e.target.value) : null })} /></Field>
    <Field><FieldLabel htmlFor="library-semester">학기</FieldLabel><select id="library-semester" value={value.semester ?? ""} disabled={disabled}
      onChange={e => onChange({ ...value, semester: e.target.value ? Number(e.target.value) as 1 | 2 : null })}>
      <option value="">지정 안 함</option><option value="1">1학기</option><option value="2">2학기</option></select></Field>
  </div>;
}

export function WordbookLibrary({ onBack, onLockChange, captureAuthenticationFailure, onSaved, active = true }: {
  onBack: () => void; onLockChange?: (locked: boolean) => void; captureAuthenticationFailure?: () => (error: unknown) => void;
  onSaved?: (book: CreatedLibraryBook) => void; active?: boolean;
}) {
  const c = useWordbookLibrary(captureAuthenticationFailure, onSaved), heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => { if (active) heading.current?.focus(); }, [active]);
  useEffect(() => { onLockChange?.(c.locked); }, [c.locked, onLockChange]);
  const selected = c.recipe.scopes.map(s => s.id);
  const availableVisible = c.visible.filter(s => s.availability === "available");
  const allVisible = availableVisible.length > 0 && availableVisible.every(s => selected.includes(s.id));
  const filtersValid = libraryFiltersSchema.safeParse(c.recipe.filters).success;
  const summary = c.selection.result;
  if (c.authenticationFailed) return <section className={styles.library}><p role="alert">관리자 로그인이 필요합니다.</p>
    {c.differentAdministrator ? <p>처음 저장한 관리자 계정으로 로그인한 뒤 결과를 확인해 주세요.</p> : null}
    <Button disabled={c.loadState === "loading"} onClick={c.actions.reauthenticate}>로그인 후 다시 확인</Button>
    {c.loadState === "loading" ? <p role="status">로그인 상태를 확인하는 중…</p> : null}</section>;
  return <section className={styles.library} aria-label="단어장과 템플릿">
    <h3 tabIndex={-1} ref={heading}>단어장과 템플릿</h3>
    <div className={styles.buttons}>
      <Button variant="filter" aria-pressed={c.tab === "saved"} disabled={c.locked} onClick={() => c.actions.setTab("saved")}>저장한 템플릿 찾기</Button>
      <Button variant="filter" aria-pressed={c.tab === "sources"} disabled={c.locked} onClick={() => c.actions.setTab("sources")}>범위로 새로 만들기</Button>
    </div>
    {c.loadState === "loading" ? <p role="status">자료를 불러오는 중…</p> : c.loadState === "error" ? <div role="alert"><p>{c.loadError}</p><Button disabled={c.locked} onClick={c.actions.reload}>다시 불러오기</Button></div> : null}
    {c.notice ? <p role="status">{c.notice}</p> : null}
    {c.tab === "saved" ? <>
      <Field><FieldLabel htmlFor="library-template-search">템플릿 검색</FieldLabel><Input id="library-template-search" value={c.search} disabled={c.locked} onChange={e => c.actions.setSearch(e.target.value)} placeholder="이름, 학교, 학기, 시험, 태그" /></Field>
      {c.loadState === "ready" && !c.templates.length ? <p role="status">이 조건에 맞는 자료가 없습니다.</p> : null}
      {c.loadState === "ready" ? <div className={styles.cards}>{c.templates.map(t => <TemplateCard key={t.id} template={t} disabled={c.locked} onOpen={c.actions.open} onUse={c.actions.materialize} />)}</div> : null}
      {c.saveState.status === "saving" ? <p role="status">단어장과 문제를 준비하는 중…</p> : null}
      {c.saveState.uncertain ? <Button onClick={() => void c.actions.save()}>같은 내용으로 저장 확인</Button> : null}
    </> : <>
      <h4>{({ create: "새 템플릿", metadata: "이름·태그 수정", version: "범위를 바꿔 새 버전 저장", copy: "선택한 버전 복사" })[c.editor.mode]}</h4>
      <Button size="small" disabled={c.locked} onClick={c.actions.newTemplate}>빈 틀로 새로 시작</Button>
      <MetadataFields key={c.editorRevision} value={c.metadata} onChange={c.actions.setMetadata} disabled={c.locked || c.editor.mode === "version"} />
      {c.conflictingTemplate ? <aside className={styles.summary} aria-label="다른 곳에서 수정한 최신 템플릿">
        <strong>최신 수정: {c.conflictingTemplate.metadata.title}</strong><p>태그: {c.conflictingTemplate.metadata.tags.join(", ") || "없음"}</p>
        <p>{latestLibraryVersion(c.conflictingTemplate).number}판 · 포함 {latestLibraryVersion(c.conflictingTemplate).includedKeys.length}개</p>
        <Button disabled={c.locked} onClick={c.actions.rebase}>현재 입력을 최신 버전에 이어서 검토</Button>
      </aside> : null}
      {c.editor.mode === "metadata" || c.editor.mode === "copy" ? <p className={styles.hint}>선택한 버전의 범위와 원뜻·발음은 그대로 보존됩니다.</p> : <>
        <label><input type="checkbox" checked={c.recipe.scopeStatus === "unconfirmed"} disabled={c.locked} onChange={e => c.actions.setScopeStatus(e.target.checked ? "unconfirmed" : "confirmed")} /> 아직 시험 범위를 정하지 않은 틀로 저장</label>
        <LibrarySourceFilters scopes={c.catalog.scopes} value={c.recipe.filters} onChange={c.actions.setFilters} disabled={c.scopesLocked} />
        {!filtersValid ? <p role="alert">시작과 끝을 포함해 검색 조건을 확인해 주세요.</p> : c.loadState === "ready" ? <>
          <div className={styles.buttons}><Button disabled={c.scopesLocked || !availableVisible.length} onClick={() => c.actions.toggleVisible(!allVisible)}>{allVisible ? "현재 조건 범위 해제" : "현재 조건 범위 담기"}</Button><span>{c.visible.length}개 범위</span></div>
          {!c.visible.length ? <p role="status">이 조건에 맞는 자료가 없습니다.</p> : <div className={styles.scopeList}>{c.visible.map(scope => <label key={scope.id} className={styles.scope}>
            <input type="checkbox" checked={selected.includes(scope.id)} disabled={c.scopesLocked || scope.availability !== "available"} onChange={() => c.actions.toggle(scope.id)} />
            <span><strong>{scope.name}</strong><small>{scope.sourceTitle} · 포함 {scope.occurrences.filter(r => r.state === "included").length}개
              {scope.availability !== "available" ? " · 현재 새로 담을 수 없는 자료" : ""}</small></span>
          </label>)}</div>}
        </> : null}
      </>}
      <div className={styles.summary} aria-live="polite">
        <strong>담은 범위 {selected.length}개{summary ? ` · 원자료 ${summary.sourceCount}개 · 포함 ${summary.includedCount}개` : ""}</strong>
        {c.recipe.scopeStatus === "unconfirmed" ? <p>시험 범위가 아직 정해지지 않았습니다.</p> : !selected.length ? <p>단어장에 넣을 범위를 선택해 주세요.</p> : null}
        {selected.some(id => !c.visible.some(s => s.id === id)) ? <p>현재 조건에서 보이지 않는 선택도 함께 보존됩니다.</p> : null}
        {c.selection.error && c.loadState === "ready" && !c.scopesLocked ? <p role="alert">담아 둔 원자료가 변경되었습니다. 해당 범위를 빼고 최신 범위를 다시 선택해 주세요.</p> : null}
        {summary && (summary.heldCount || summary.excludedCount) ? <p>보류 {summary.heldCount}개 · 제외 {summary.excludedCount}개</p> : null}
        {c.difference ? <p>이전 버전과 비교: 추가 {c.difference.added.length}개 · 빠짐 {c.difference.removed.length}개{c.difference.orderChanged ? " · 순서 변경" : ""}</p> : null}
        <p className={styles.hint}>출처별 포함 수입니다. 실제 시험 문항 수는 사용할 방향과 범위를 확인한 뒤 정해집니다.</p>
        {summary?.occurrences.length ? <SelectedWords key={c.editorRevision} rows={summary.occurrences} excluded={c.recipe.excludedOccurrenceKeys} onToggle={c.actions.exclude} disabled={c.scopesLocked} /> : null}
        {selected.length ? <details><summary>담은 범위와 순서 보기</summary>{c.recipe.scopes.map((s, i) => <div key={s.id} className={styles.selectedRow}>
          <span>{c.catalog.scopes.find(x => x.id === s.id)?.name ?? "이전 판에 담은 범위"}</span><div className={styles.buttons}>
            <Button size="small" disabled={c.scopesLocked || i === 0} onClick={() => c.actions.move(s.id, -1)}>위로</Button>
            <Button size="small" disabled={c.scopesLocked || i === selected.length - 1} onClick={() => c.actions.move(s.id, 1)}>아래로</Button>
            <Button size="small" disabled={c.scopesLocked} onClick={() => c.actions.toggle(s.id)}>빼기</Button>
          </div></div>)}<Button disabled={c.scopesLocked} onClick={c.actions.clear}>담은 범위 모두 비우기</Button></details> : null}
      </div>
      <Button disabled={c.saveState.status === "saving" || (!c.saveState.uncertain && c.loadState !== "ready")} onClick={() => void c.actions.save()}>
        {c.saveState.status === "saving" ? "저장 확인 중…" : c.saveState.uncertain ? "같은 내용으로 저장 확인" : c.editor.mode === "version" ? "새 버전 저장" : "템플릿 저장"}
      </Button>
    </>}
    {c.saveState.error ? <div role="alert"><p>{c.saveState.error}</p>{!c.locked ? <Button onClick={c.actions.reload}>최신 자료 다시 확인</Button> : null}</div> : null}
    <Button disabled={c.locked} onClick={onBack}>단어장 찾기로 돌아가기</Button>
  </section>;
}
