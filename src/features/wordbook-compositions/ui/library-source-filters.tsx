import { Button } from "@/design-system/primitives/button/button";
import { Field, FieldLabel, Input } from "@/design-system/primitives/form/field";
import { EMPTY_LIBRARY_FILTERS, type LibraryFilters, type LibraryScope } from "../contracts/library";
import { toggleFilterValue } from "../domain/scope-selection";
import styles from "./wordbook-library.module.css";

const kindLabels = { textbook: "교과서", wordbook: "일반 단어장", mock: "모의고사", csat: "수능", school: "학교 자료", unclassified: "기타 자료" };
const gradeLabel = (value: string) => ({ g10: "고1", g11: "고2", g12: "고3", g7: "중1", g8: "중2", g9: "중3" })[value] ?? value;

export function LibrarySourceFilters({ scopes, value, onChange, disabled = false }: {
  scopes: readonly LibraryScope[]; value: LibraryFilters; onChange: (value: LibraryFilters) => void; disabled?: boolean;
}) {
  const classifications = scopes.map(s => s.classification), exams = classifications.flatMap(c => c.exam ? [c.exam] : []);
  const numbers = (values: (number | null)[]) => [...new Set(values.filter((n): n is number => n !== null))].sort((a, b) => a - b);
  const labels = (values: (string | null)[]) => [...new Set(values.filter((v): v is string => v !== null))].sort((a, b) => a.localeCompare(b, "ko-KR"));
  type GroupKey = "kinds" | "years" | "months" | "types" | "questions" | "sourceGrades" | "lessons" | "schools" | "targetGrades" | "semesters" | "assessments" | "purposes";
  const group = (key: GroupKey, label: string, options: { value: number | string; label: string }[]) => options.length ?
    <fieldset className={styles.filter} disabled={disabled} key={key}><legend>{label}</legend><div className={styles.buttons}>
      <Button size="small" variant="filter" aria-pressed={!value[key].length} onClick={() => onChange({ ...value, [key]: [] })}>전체</Button>
      {options.map(o => <Button key={o.value} size="small" variant="filter" aria-pressed={(value[key] as (string | number)[]).includes(o.value)}
        onClick={() => onChange({ ...value, [key]: toggleFilterValue(value[key] as (string | number)[], o.value) })}>{o.label}</Button>)}
    </div></fieldset> : null;
  const range = (from: "yearFrom" | "dayFrom", to: "yearTo" | "dayTo", label: string, min: number, max: number) =>
    <fieldset className={styles.filter} disabled={disabled}><legend>{label}</legend><div className={styles.range}>
      <Field><FieldLabel htmlFor={`library-${from}`}>시작</FieldLabel><Input id={`library-${from}`} aria-label={`${label} 시작`} type="number" min={min} max={max} value={value[from] ?? ""}
        onChange={e => onChange({ ...value, [from]: e.target.value === "" ? null : Number(e.target.value) })} /></Field>
      <span>~</span><Field><FieldLabel htmlFor={`library-${to}`}>끝</FieldLabel><Input id={`library-${to}`} aria-label={`${label} 끝`} type="number" min={min} max={max} value={value[to] ?? ""}
        onChange={e => onChange({ ...value, [to]: e.target.value === "" ? null : Number(e.target.value) })} /></Field>
    </div></fieldset>;
  return <div className={styles.filters}>
    <Field><FieldLabel htmlFor="library-source-search">원자료 찾기</FieldLabel><Input id="library-source-search" value={value.search} disabled={disabled} maxLength={240}
      placeholder="교과서 이름, 학교, 유형으로 찾기" onChange={e => onChange({ ...value, search: e.target.value })} /></Field>
    {group("kinds", "자료 종류", labels(classifications.map(c => c.kind)).map(v => ({ value: v, label: kindLabels[v as keyof typeof kindLabels] })))}
    {range("yearFrom", "yearTo", "시행연도 구간", 2000, 2100)}
    {group("years", "개별 시행연도", numbers(exams.map(e => e.executionYear)).map(v => ({ value: v, label: `${v}년` })))}
    {group("months", "월", numbers(exams.map(e => e.examMonth)).map(v => ({ value: v, label: `${v}월` })))}
    {group("types", "유형", [...new Map(exams.map(e => [e.typeCode, e.typeLabel])).entries()].map(([v, label]) => ({ value: v, label })))}
    <details><summary>문제번호·교과서·DAY·학교 조건</summary><div className={styles.filters}>
      {group("questions", "문제번호", numbers(exams.flatMap(e => e.questionNumbers)).map(v => ({ value: v, label: `${v}번` })))}
      {range("dayFrom", "dayTo", "DAY 구간", 1, 999)}
      {group("lessons", "교과서 과", numbers(classifications.map(c => c.lesson)).map(v => ({ value: v, label: `${v}과` })))}
      {group("sourceGrades", "원자료 학년", labels(classifications.map(c => c.sourceGrade)).map(v => ({ value: v, label: gradeLabel(v) })))}
      {group("schools", "학교", labels(classifications.map(c => c.school)).map(v => ({ value: v, label: v })))}
      {group("targetGrades", "사용 대상 학년", labels(classifications.map(c => c.targetGrade)).map(v => ({ value: v, label: gradeLabel(v) })))}
      {group("semesters", "학기", numbers(classifications.map(c => c.semester)).map(v => ({ value: v, label: `${v}학기` })))}
      {group("assessments", "시험", labels(classifications.map(c => c.assessment)).map(v => ({ value: v, label: v })))}
      {group("purposes", "용도", labels(classifications.map(c => c.purpose)).map(v => ({ value: v, label: v })))}
    </div></details>
    <Button size="small" disabled={disabled} onClick={() => onChange(EMPTY_LIBRARY_FILTERS)}>검색 조건 초기화</Button>
  </div>;
}
