import { Button } from "@/design-system/primitives/button/button";
import { useId } from "react";
import { Field, FieldLabel, Input } from "@/design-system/primitives/form/field";
import type { MockScopeMetadata } from "../contracts/composition";
import { toggleFilterValue, type ScopeFilters } from "../domain/scope-selection";
import styles from "./wordbook-composer.module.css";

export function MockScopeFilters({ scopes, value, onChange, disabled = false }: {
  scopes: readonly MockScopeMetadata[]; value: ScopeFilters; onChange: (filters: ScopeFilters) => void; disabled?: boolean;
}) {
  const inputId = useId();
  const years = [...new Set(scopes.map(s => s.executionYear))].sort((a, b) => b - a);
  const months = [...new Set(scopes.map(s => s.examMonth))].sort((a, b) => a - b);
  const types = [...new Map(scopes.map(s => [s.typeCode, s.typeLabel])).entries()];
  const groups = [
    { key: "years" as const, label: "연도", options: years.map(v => ({ value: v, label: `${v}년` })) },
    { key: "months" as const, label: "월", options: months.map(v => ({ value: v, label: `${v}월` })) },
    { key: "types" as const, label: "유형", options: types.map(([v, label]) => ({ value: v, label })) },
    { key: "questions" as const, label: "문제번호", options: [...new Set(scopes.flatMap(s => s.questionNumbers))].sort((a, b) => a - b).map(v => ({ value: v, label: `${v}번` })) },
    { key: "examKinds" as const, label: "시험 종류", options: [...new Set(scopes.map(s => s.examKind))].map(v => ({ value: v, label: v === "csat" ? "수능" : "모의고사" })) },
  ];
  return <div className={styles.filters}>
    <fieldset className={styles.filter} disabled={disabled}><legend>시행연도 구간</legend><div className={styles.buttons}>
      <Field><FieldLabel htmlFor={`${inputId}-from`}>시작 연도</FieldLabel><Input id={`${inputId}-from`} type="number" min={2000} max={2100} value={value.yearFrom ?? ""} onChange={e => onChange({ ...value, yearFrom: e.target.value ? Number(e.target.value) : null })} /></Field>
      <Field><FieldLabel htmlFor={`${inputId}-to`}>끝 연도</FieldLabel><Input id={`${inputId}-to`} type="number" min={2000} max={2100} value={value.yearTo ?? ""} onChange={e => onChange({ ...value, yearTo: e.target.value ? Number(e.target.value) : null })} /></Field>
    </div>{value.yearFrom != null && value.yearTo != null && value.yearFrom > value.yearTo ? <p role="alert">시작 연도가 끝 연도보다 늦습니다.</p> : null}</fieldset>
    {groups.map(group => <fieldset className={styles.filter} key={group.key} disabled={disabled}>
    <legend>{group.label}</legend><div className={styles.buttons}>
      <Button variant="filter" size="small" aria-pressed={!value[group.key]?.length}
        onClick={() => onChange({ ...value, [group.key]: [] })}>전체</Button>
      {group.options.map(option => <Button key={option.value} variant="filter" size="small"
        aria-pressed={(value[group.key] as readonly (string | number)[] | undefined)?.includes(option.value) ?? false}
        onClick={() => onChange({ ...value, [group.key]: toggleFilterValue(value[group.key] as readonly (string | number)[] ?? [], option.value) })}>
        {option.label}
      </Button>)}
    </div>
  </fieldset>)}</div>;
}
