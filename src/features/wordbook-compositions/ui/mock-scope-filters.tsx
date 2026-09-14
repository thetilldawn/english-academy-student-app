import { Button } from "@/design-system/primitives/button/button";
import type { MockScopeMetadata } from "../contracts/composition";
import { toggleFilterValue, type ScopeFilters } from "../domain/scope-selection";
import styles from "./wordbook-composer.module.css";

export function MockScopeFilters({ scopes, value, onChange, disabled = false }: {
  scopes: readonly MockScopeMetadata[]; value: ScopeFilters; onChange: (filters: ScopeFilters) => void; disabled?: boolean;
}) {
  const years = [...new Set(scopes.map(s => s.executionYear))].sort((a, b) => b - a);
  const months = [...new Set(scopes.map(s => s.examMonth))].sort((a, b) => a - b);
  const types = [...new Map(scopes.map(s => [s.typeCode, s.typeLabel])).entries()];
  const groups = [
    { key: "years" as const, label: "연도", options: years.map(v => ({ value: v, label: `${v}년` })) },
    { key: "months" as const, label: "월", options: months.map(v => ({ value: v, label: `${v}월` })) },
    { key: "types" as const, label: "유형", options: types.map(([v, label]) => ({ value: v, label })) },
  ];
  return <div className={styles.filters}>{groups.map(group => <fieldset className={styles.filter} key={group.key} disabled={disabled}>
    <legend>{group.label}</legend><div className={styles.buttons}>
      <Button variant="filter" size="small" aria-pressed={value[group.key].length === 0}
        onClick={() => onChange({ ...value, [group.key]: [] })}>전체</Button>
      {group.options.map(option => <Button key={option.value} variant="filter" size="small"
        aria-pressed={(value[group.key] as readonly (string | number)[]).includes(option.value)}
        onClick={() => onChange({ ...value, [group.key]: toggleFilterValue(value[group.key] as readonly (string | number)[], option.value) })}>
        {option.label}
      </Button>)}
    </div>
  </fieldset>)}</div>;
}
