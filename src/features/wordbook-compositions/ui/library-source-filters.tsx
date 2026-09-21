"use client";
import { Button } from "@/design-system/primitives/button/button";
import { Field, FieldError, FieldLabel, Input, Select } from "@/design-system/primitives/form/field";
import { type LibraryFilters } from "../contracts/library";
import { type LibraryCriteriaGroup, type LibraryFacets } from "../contracts/library-query";
import { gradeLabel, kindFilters, needsBook } from "../domain/library-editor";
import { toggleFilterValue } from "../domain/scope-selection";
import styles from "./wordbook-library.module.css";

export function LibrarySourceFilters({ facets, group, onChange, onDatasetChange, disabled }: {
  facets: LibraryFacets; group: LibraryCriteriaGroup; onChange: (filters: LibraryFilters) => void; onDatasetChange: (id: string | null) => void; disabled: boolean;
}) {
  const value = group.filters;
  const isExam = group.kind === "mock" || group.kind === "csat";
  const books = facets.books;
  const prefix = `library-${group.id}`;
  type GroupKey = "years" | "months" | "types" | "questions" | "lessons" | "sourceGrades" | "schools" | "targetGrades" | "semesters" | "assessments";
  const options = (key: GroupKey, label: string, choices: { value: number | string; label: string; unavailable?: boolean }[]) => choices.length ?
    <fieldset className={styles.filter} disabled={disabled} key={key}><legend>{label}</legend><div className={styles.buttons}>
      <Button size="small" variant="filter" aria-pressed={!value[key].length} onClick={() => onChange({ ...value, [key]: [] })}>전체</Button>
      {choices.map(o => <Button key={o.value} size="small" variant="filter" disabled={o.unavailable} aria-pressed={(value[key] as (string | number)[]).includes(o.value)}
        onClick={() => onChange({ ...value, [key]: toggleFilterValue(value[key] as (string | number)[], o.value) })}>{o.label}{o.unavailable ? " · 미등록" : ""}</Button>)}
    </div></fieldset> : null;
  const range = (from: "yearFrom" | "dayFrom", to: "yearTo" | "dayTo", label: string, min: number, max: number) => {
    const start = value[from], end = value[to];
    const invalid = (n: number | null) => n !== null && (!Number.isInteger(n) || n < min || n > max);
    const error = invalid(start) || invalid(end) ? `${min}~${max} 사이의 수를 입력해 주세요.` : start !== null && end !== null && start > end ? "시작이 끝보다 큽니다. 구간을 확인해 주세요." : null;
    return <fieldset className={styles.filter} disabled={disabled}><legend>{label}</legend><div className={styles.range}>
      {([from, to] as const).map((key, i) => <Field key={key}><FieldLabel htmlFor={`${prefix}-${key}`}>{i ? "끝" : "시작"}</FieldLabel>
        <Input id={`${prefix}-${key}`} aria-label={`${label} ${i ? "끝" : "시작"}`} aria-invalid={!!error} aria-describedby={error ? `${prefix}-${from}-error` : undefined}
          type="number" min={min} max={max} value={value[key] ?? ""} onChange={e => onChange({ ...value, [key]: e.target.value === "" ? null : Number(e.target.value) })} />
      </Field>)}
    </div>{error ? <FieldError id={`${prefix}-${from}-error`}>{error}</FieldError> : null}</fieldset>;
  };
  return <div className={styles.filters}>
    {needsBook(group.kind) ? <Field><FieldLabel htmlFor={`${prefix}-book`}>자료 선택</FieldLabel>
      <Select id={`${prefix}-book`} value={group.datasetId ?? ""} disabled={disabled} aria-invalid={!group.datasetId} aria-describedby={!group.datasetId ? `${prefix}-book-error` : undefined}
        onChange={e => onDatasetChange(e.target.value || null)}><option value="">사용할 자료를 고르세요</option>{group.datasetId && !books.some(b => b.id === group.datasetId) ? <option value={group.datasetId}>현재 선택한 자료</option> : null}{books.map(b => <option key={b.id} value={b.id}>{b.title}</option>)}</Select>
      {!group.datasetId ? <FieldError id={`${prefix}-book-error`}>먼저 교재 또는 자료를 선택해 주세요.</FieldError> : null}
    </Field> : null}
    {(!needsBook(group.kind) || group.datasetId) ? <>
      <Field><FieldLabel htmlFor={`${prefix}-search`}>이 묶음 안에서 찾기</FieldLabel><Input id={`${prefix}-search`} value={value.search} disabled={disabled} maxLength={240}
        placeholder="자료명 또는 범위명" onChange={e => onChange({ ...value, search: e.target.value })} /></Field>
      {options("sourceGrades", "원자료 학년", facets.sourceGrades.map(v => ({ ...v, label: gradeLabel(String(v.value)) })))}
      {isExam ? <>
        {range("yearFrom", "yearTo", "시행연도 구간", 2000, 2100)}
        <p className={styles.hint}>연도 구간을 입력하면 개별 연도 선택은 해제됩니다.</p>
        {options("years", "개별 시행연도", facets.years.map(v => ({ ...v, label: group.kind === "csat" ? v.label : `${v.value}년` })))}
        {group.kind === "mock" ? options("months", "월", facets.months.map(v => ({ ...v, label: `${v.value}월` }))) : <p className={styles.hint}>수능은 학년도와 실제 시행연도를 함께 표시합니다.</p>}
        {options("types", "유형", facets.types.map(v => ({ ...v, unavailable: v.count === 0 })))}
        {group.kind === "csat" ? <p className={styles.hint}>현재 등록된 수능 유형: {facets.types.filter(v => v.count > 0).map(v => v.label).join(", ") || "없음"}. ‘미등록’ 유형은 원자료 검토와 등록 후 사용할 수 있습니다.</p> : null}
        <details><summary>문제번호로 더 좁히기</summary><p className={styles.hint}>유형을 바꾸면 문제번호 선택은 해제됩니다.</p>{options("questions", "문제번호", facets.questions.map(v => ({ ...v, label: `${v.value}번` })))}</details>
      </> : null}
      {group.kind === "wordbook" ? range("dayFrom", "dayTo", "DAY 구간", 1, 999) : null}
      {group.kind === "textbook" ? options("lessons", "교과서 과", facets.lessons.map(v => ({ ...v, label: `${v.value}과` }))) : null}
      {group.kind === "school" ? <>
        {options("schools", "자료의 학교", facets.schools)}
        {options("targetGrades", "자료의 대상 학년", facets.targetGrades.map(v => ({ ...v, label: gradeLabel(String(v.value)) })))}
        {options("semesters", "자료의 학기", facets.semesters.map(v => ({ ...v, label: `${v.value}학기` })))}
        {options("assessments", "자료의 시험", facets.assessments)}
      </> : null}
      <Button size="small" disabled={disabled} onClick={() => onChange(kindFilters(group.kind))}>이 묶음의 조건 초기화</Button>
    </> : null}
  </div>;
}
