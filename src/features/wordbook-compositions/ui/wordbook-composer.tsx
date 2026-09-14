"use client";

import { useEffect, useRef } from "react";
import { Button } from "@/design-system/primitives/button/button";
import { Field, FieldLabel, Input } from "@/design-system/primitives/form/field";
import type { CreatedComposition } from "../contracts/composition";
import { useWordbookComposer } from "../client/controllers/use-wordbook-composer";
import { MockScopeFilters } from "./mock-scope-filters";
import styles from "./wordbook-composer.module.css";

export function WordbookComposer({ onSaved, onBack, onLockChange, captureAuthenticationFailure, active = true }: { onSaved: (book: CreatedComposition) => void; onBack: () => void; onLockChange?: (locked: boolean) => void; captureAuthenticationFailure?: () => (error: unknown) => void; active?: boolean }) {
  const c = useWordbookComposer(onSaved, captureAuthenticationFailure);
  const heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => { if (active) heading.current?.focus(); }, [active]);
  useEffect(() => { onLockChange?.(c.locked); }, [c.locked, onLockChange]);
  const allVisibleSelected = c.visible.length > 0 && c.visible.every(s => c.selectedIds.includes(s.id));
  const hiddenCount = c.selectedIds.filter(id => !c.visible.some(s => s.id === id)).length;
  return <section className={styles.composer} aria-label="모의고사 단어장 만들기">
    <h3 ref={heading} tabIndex={-1}>모의고사 단어장 만들기</h3>
    <p className={styles.hint}>연도·월·유형을 골라 범위를 담으세요. 저장한 뒤에도 시험마다 범위를 다시 고를 수 있습니다.</p>
    <Field><FieldLabel htmlFor="composition-title">단어장 이름</FieldLabel>
      <Input id="composition-title" maxLength={100} value={c.title} disabled={c.locked} onChange={e => c.actions.setTitle(e.target.value)} placeholder="예: 고3 3개년 빈칸·장문" />
    </Field>
    <MockScopeFilters scopes={c.catalog.scopes.map(s => s.metadata)} value={c.filters} onChange={c.actions.setFilters} disabled={c.locked} />
    {c.catalog.status === "loading" ? <p role="status">모의고사 범위를 불러오는 중…</p> : c.catalog.status === "error" ? <div role="alert">
      <p>{c.catalog.error}</p><Button onClick={c.actions.reload}>다시 불러오기</Button>
    </div> : <>
      <div className={styles.actions}><Button variant="filter" aria-pressed={allVisibleSelected} disabled={c.locked || !c.visible.length}
        onClick={() => c.actions.toggleVisible(!allVisibleSelected)}>{allVisibleSelected ? "현재 조건 범위 해제" : "현재 조건 범위 담기"}</Button>
        <span>{c.visible.length}개 범위</span></div>
      {!c.visible.length ? <p role="status">이 조건에 맞는 준비된 자료가 없습니다.</p> : <div className={styles.scopeList}>
        {c.visible.map(scope => <label className={styles.scope} key={scope.id}>
          <input type="checkbox" checked={c.selectedIds.includes(scope.id)} disabled={c.locked} onChange={() => c.actions.toggle(scope.id)} />
          <span><strong>{scope.displayName}</strong><small className={styles.hint}>{scope.sourceTitle} · 수록 {scope.sourceEntryCount}개 · 포함 {scope.includedEntryCount}개</small></span>
        </label>)}
      </div>}
    </>}
    <div className={styles.summary} aria-live="polite">
      <strong>담은 범위 {c.selectedIds.length}개 · 포함 단어 {c.summary.includedEntryCount}개</strong>
      {hiddenCount > 0 ? <p>현재 조건에서 보이지 않는 선택 {hiddenCount}개도 함께 저장됩니다.</p> : null}
      <p className={styles.hint}>출처별로 센 수량입니다. 같은 품사·뜻으로 확인된 단어는 시험 범위를 고른 뒤 정리합니다.</p>
      {c.selectedIds.length ? <details><summary>담은 범위 모두 보기</summary>{c.summary.scopes.map(s => <p key={s.id}>{s.displayName} <Button size="small" disabled={c.locked} onClick={() => c.actions.toggle(s.id)}>빼기</Button></p>)}</details> : <p>시험에 넣을 범위를 선택해 주세요.</p>}
    </div>
    {c.saveState.error ? <p role="alert">{c.saveState.error}</p> : null}
    {c.staleIds.length > 0 && c.catalog.status === "ready" ? <p role="alert">담은 범위 {c.staleIds.length}개의 준비 상태가 바뀌었습니다. ‘담은 범위 모두 보기’에서 빼고 다시 선택해 주세요.</p> : null}
    <div className={styles.actions}>
      <Button disabled={c.saveState.status === "saving" || Boolean(c.saveState.uncertain)} onClick={onBack}>단어장 찾기로 돌아가기</Button>
      <Button disabled={c.saveState.status === "saving" || (!c.saveState.uncertain && (c.catalog.status !== "ready" || !c.title.trim() || !c.selectedIds.length || c.staleIds.length > 0))} onClick={() => void c.actions.save()}>
        {c.saveState.status === "saving" ? "저장 확인 중…" : c.saveState.uncertain ? "같은 내용으로 저장 확인" : "단어장 저장"}
      </Button>
    </div>
  </section>;
}
