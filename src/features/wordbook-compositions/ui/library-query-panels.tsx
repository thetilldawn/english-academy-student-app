"use client";
import { useState } from "react";
import { Button } from "@/design-system/primitives/button/button";
import { Input } from "@/design-system/primitives/form/field";
import { EMPTY_LIBRARY_FILTERS, libraryFiltersSchema } from "../contracts/library";
import { type LibraryQuery, type LibraryTemplateSummary, type LibraryVersionSummary } from "../contracts/library-query";
import { type useWordbookLibrary } from "../client/controllers/use-wordbook-library";
import { useLibraryPage } from "../client/controllers/use-library-page";
import { libraryScopeLabel, needsBook } from "../domain/library-editor";
import { LibrarySourceFilters } from "./library-source-filters";
import styles from "./wordbook-library.module.css";

type Controller = ReturnType<typeof useWordbookLibrary>;
export function LibraryPageStatus({ page }: { page: { status: string; error: string; reload: () => void } }) {
  return page.status === "loading" ? <p role="status">자료를 불러오는 중…</p> : page.status === "error" ? <div role="alert"><p>{page.error}</p><Button size="small" onClick={page.reload}>다시 불러오기</Button></div> : null;
}

export function LibraryRangePanel({ c }: { c: Controller }) {
  const group = c.activeGroup!;
  const [bookSearch, setBookSearch] = useState(""), [expanded, setExpanded] = useState(false);
  const facets = useLibraryPage(group.mode === "filter" ? { kind: "facets", sourceKind: group.kind, datasetId: group.datasetId, bookSearch, cursor: null, limit: 30 } : null, c.viewerId, c.reportError);
  const ready = libraryFiltersSchema.safeParse(group.filters).success && (group.mode === "fixed" || !needsBook(group.kind) || !!group.datasetId);
  const scopes = useLibraryPage(expanded && ready ? { kind: "scopes", filters: group.filters, datasetId: group.datasetId, ...(group.mode === "fixed" ? { refs: group.scopes } : {}), cursor: null, limit: 30 } : null, c.viewerId, c.reportError);
  const selected = c.preview.data?.groups.find(g => g.id === group.id)?.scopes ?? group.scopes;
  const rows = scopes.data?.items ?? [];
  const includes = (scope: (typeof rows)[number]) => group.mode === "fixed" ? group.scopes.some(r => r.id === scope.id) : scope.availability === "available" && !group.excludedScopeKeys.includes(scope.scopeKey);
  const all = rows.length > 0 && rows.every(includes);
  return <div className={styles.groupEditor}>
    {group.mode === "fixed" ? <p className={styles.hint}>직접 선택해 저장한 범위와 순서를 유지합니다. 다른 자료는 새 묶음으로 추가할 수 있습니다.</p> : <>
      {needsBook(group.kind) ? <Input aria-label="자료명으로 찾기" value={bookSearch} disabled={c.scopesLocked} placeholder="교재 또는 자료명" onChange={e => setBookSearch(e.target.value)} /> : null}
      <LibraryPageStatus page={facets} />
      {facets.data ? <LibrarySourceFilters facets={facets.data.facets} group={group} disabled={c.scopesLocked} onChange={c.actions.setFilters} onDatasetChange={c.actions.setDataset} /> : null}
      {facets.data?.nextCursor ? <Button size="small" disabled={facets.status !== "ready"} onClick={facets.more}>자료 30개 더 보기</Button> : null}
    </>}
    <strong aria-live="polite">{c.preview.status === "loading" ? "범위를 확인하는 중…" : `이 묶음에 포함 ${selected.length}개 범위`}</strong>
    <details open={expanded} onToggle={e => setExpanded(e.currentTarget.open)}><summary>세부 범위 확인·제외</summary>
      <LibraryPageStatus page={scopes} />
      {scopes.status === "ready" && !rows.length ? <p>이 조건에 맞는 등록 자료가 없습니다. 연도·유형 또는 자료 범위를 확인해 주세요.</p> : null}
      {rows.length ? <Button size="small" disabled={c.scopesLocked || scopes.status !== "ready"} onClick={() => c.actions.toggleVisible(rows, !all)}>{all ? "보이는 범위 모두 해제" : "보이는 범위 모두 포함"}</Button> : null}
      <div className={styles.scopeList}>{rows.map(scope => <label key={scope.id} className={styles.scope}>
        <input type="checkbox" checked={includes(scope)} disabled={c.scopesLocked || scope.availability !== "available" && !includes(scope)} onChange={e => c.actions.toggle(scope, e.target.checked)} />
        <span><strong>{libraryScopeLabel(scope)}</strong><small>{scope.classification.kind === "csat" ? "수능 원자료" : scope.sourceTitle} · 포함 {scope.includedCount}개{scope.availability !== "available" ? " · 현재 사용할 수 없음" : ""}</small></span>
      </label>)}</div>
      {scopes.data?.nextCursor ? <Button size="small" disabled={scopes.status !== "ready"} onClick={scopes.more}>범위 30개 더 보기</Button> : null}
    </details>
  </div>;
}

export function LibrarySelectedDetails({ c }: { c: Controller }) {
  const [wordsOpen, setWordsOpen] = useState(false), [rangesOpen, setRangesOpen] = useState(false), [search, setSearch] = useState("");
  const preview = c.preview.data, frozen = c.editor.mode === "metadata" || c.editor.mode === "copy";
  const recipe = frozen ? c.editor.detail?.recipe : preview?.recipe;
  const wordsQuery: Extract<LibraryQuery, { kind: "words" }> | null = wordsOpen && (frozen || c.preview.status === "ready") && recipe
    ? { kind: "words", ...(frozen && c.editor.detail ? { versionId: c.editor.detail.version.id, contentHash: c.editor.detail.version.contentHash } : { selection: { mode: "recipe", recipe }, contentHash: preview!.contentHash }), search, cursor: null, limit: 50 } : null;
  const words = useLibraryPage(wordsQuery, c.viewerId, c.reportError);
  const ranges = useLibraryPage(rangesOpen && recipe ? { kind: "scopes", refs: recipe.scopes, filters: EMPTY_LIBRARY_FILTERS, datasetId: null, cursor: null, limit: 30 } : null, c.viewerId, c.reportError);
  return <>
    <details open={rangesOpen} onToggle={e => setRangesOpen(e.currentTarget.open)}><summary>담은 범위와 순서 확인</summary>
      <LibraryPageStatus page={ranges} />
      {ranges.data?.items.map(s => { const index = recipe?.scopes.findIndex(r => r.id === s.id) ?? -1; return <div className={styles.selectedRow} key={s.id}>
        <span>{index + 1}. {libraryScopeLabel(s)}</span><div className={styles.buttons}>
          <Button size="small" disabled={c.scopesLocked || index <= 0 || c.preview.status !== "ready"} aria-label={`${libraryScopeLabel(s)} 앞으로`} onClick={() => c.actions.move(s.id, -1)}>앞으로</Button>
          <Button size="small" disabled={c.scopesLocked || index === (recipe?.scopes.length ?? 0) - 1 || c.preview.status !== "ready"} aria-label={`${libraryScopeLabel(s)} 뒤로`} onClick={() => c.actions.move(s.id, 1)}>뒤로</Button>
        </div></div>; })}
      {ranges.data?.nextCursor ? <Button size="small" disabled={ranges.status !== "ready"} onClick={ranges.more}>담은 범위 30개 더 보기</Button> : null}
      <p className={styles.hint}>전체 순서를 직접 바꾸면 선택한 범위를 고정해서 저장합니다.</p>
    </details>
    <details open={wordsOpen} onToggle={e => setWordsOpen(e.currentTarget.open)}><summary>단어별 포함·제외</summary>
      <Input aria-label="담은 단어에서 찾기" value={search} onChange={e => setSearch(e.target.value)} placeholder="단어 또는 뜻" />
      <LibraryPageStatus page={words} />
      <div className={styles.scopeList}>{words.data?.items.map(row => <label key={row.key} className={styles.scope}>
        <input type="checkbox" checked={row.selected} disabled={c.scopesLocked || row.state !== "included" || c.preview.status !== "ready"} onChange={() => c.actions.exclude(row.key)} />
        <span>{row.headword ?? `원자료 ${row.sourceRow}번`}<small>{row.meaning ?? ""}{row.state === "held" ? " · 검토 대기" : row.state === "excluded" ? " · 출제 제외 자료" : ""}</small></span>
      </label>)}</div>
      {words.data ? <p>{words.data.total}개 중 {words.data.items.length}개 표시</p> : null}
      {words.data?.nextCursor ? <Button size="small" disabled={words.status !== "ready"} onClick={words.more}>단어 50개 더 보기</Button> : null}
    </details>
  </>;
}

export function LibraryTemplateCard({ template: t, c, navigate, onDelete }: { template: LibraryTemplateSummary; c: Controller; navigate: (action: () => void) => void; onDelete: () => void }) {
  const [expanded, setExpanded] = useState(false), [selectedVersion, setSelectedVersion] = useState<LibraryVersionSummary | null>(null);
  const versions = useLibraryPage(expanded ? { kind: "versions", templateId: t.id, cursor: null, limit: 20 } : null, c.viewerId, c.reportError);
  const v = selectedVersion ?? t.latestVersion;
  const empty = v.scopeStatus === "confirmed" && v.includedCount === 0;
  return <article className={styles.card}>
    <h4>{t.metadata.title}</h4><p>{t.metadata.tags.map(tag => <span className={styles.tag} key={tag}>{tag}</span>)}</p>
    <p>{v.scopeStatus === "unconfirmed" ? "시험 범위가 아직 정해지지 않았습니다." : `${v.number}판 · 범위 ${v.scopeCount}개 · 원자료 ${v.sourceCount}개 · 포함 ${v.includedCount}개`}</p>
    <details open={expanded} onToggle={e => setExpanded(e.currentTarget.open)}><summary>이전 저장 버전 보기</summary>
      <LibraryPageStatus page={versions} />
      {versions.data ? <label>저장 버전 <select aria-label={`${t.metadata.title} 저장 버전`} value={v.id} disabled={c.locked} onChange={e => setSelectedVersion(versions.data?.items.find(v => v.id === e.target.value) ?? null)}>
        {!versions.data.items.some(item => item.id === v.id) ? <option value={v.id}>{v.number}판 · 포함 {v.includedCount}개</option> : null}
        {versions.data.items.map(v => <option key={v.id} value={v.id}>{v.number}판 · 포함 {v.includedCount}개</option>)}
      </select></label> : null}
      {versions.data?.nextCursor ? <Button size="small" disabled={versions.status !== "ready"} onClick={versions.more}>이전 버전 20개 더 보기</Button> : null}
    </details>
    <div className={styles.buttons}>
      <Button size="small" disabled={c.locked} onClick={() => navigate(() => { void c.actions.open(t, t.latestVersion, "metadata"); })}>이름·대상 수정</Button>
      <Button size="small" disabled={c.locked} onClick={() => navigate(() => { void c.actions.open(t, v, "version"); })}>범위 바꾸기</Button>
      <Button size="small" disabled={c.locked || empty} onClick={() => navigate(() => { void c.actions.open(t, v, "copy"); })}>복사</Button>
      <Button size="small" disabled={c.locked || empty || v.scopeStatus === "unconfirmed"} onClick={() => navigate(() => { void c.actions.open(t, v, "use"); })}>{v.datasetId ? "이 단어장 사용" : "이 범위로 단어장 만들기"}</Button>
      <Button size="small" variant="danger" disabled={c.locked} onClick={onDelete}>템플릿 삭제</Button>
    </div>
  </article>;
}
