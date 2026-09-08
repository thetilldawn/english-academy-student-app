import type { Ref } from "react";

import { Button } from "@/design-system/primitives/button/button";
import { Field, FieldLabel, Input, Select } from "@/design-system/primitives/form/field";

import type { DatasetPickerFilters } from "../domain/assignment-dataset-picker";
import { datasetPickerTitle, datasetSchoolGroup, type DatasetFilterButton, type DatasetPickerOption } from "../presentation/assignment-dataset-picker-view";
import styles from "./assignment-dataset-picker.module.css";

function FilterButtons<Value extends string>({
  label, options, value, onChange,
}: {
  label: string;
  options: readonly DatasetFilterButton<Value>[];
  value: Value;
  onChange: (value: Value) => void;
}) {
  return (
    <div aria-label={label} className={styles.filterGroup} role="group">
      <span className={styles.filterLabel}>{label}</span>
      <div className={styles.filterButtons}>
        {options.map((option) => (
          <Button
            aria-label={`${option.label} ${option.count}권`}
            aria-pressed={value === option.value}
            key={option.value}
            onClick={() => onChange(option.value)}
            size="small"
            variant="filter"
          >
            {option.label} <span className={styles.count}>{option.count}</span>
          </Button>
        ))}
      </div>
    </div>
  );
}

function BookList({
  title, options, selectedId, onSelect,
}: {
  title: string;
  options: readonly DatasetPickerOption[];
  selectedId: string;
  onSelect: (id: string) => void;
}) {
  if (!options.length) return null;
  return (
    <section aria-label={title} className={styles.resultsSection}>
      <h3 className={styles.sectionTitle}>{title}</h3>
      <ul className={styles.bookList}>
        {options.map(({ dataset, reviewCount }) => (
          <li key={dataset.id}>
            <Button
              aria-pressed={dataset.id === selectedId}
              className={styles.bookRow}
              onClick={() => onSelect(dataset.id)}
            >
              <span className={styles.bookText}>
                <strong>{datasetPickerTitle(dataset)}</strong>
              </span>
              <span className={styles.bookStatus}>
                <span>{reviewCount === undefined ? `수록 ${dataset.rowCount}개` : `미배정 오답 ${reviewCount}개`}</span>
                <span>{dataset.id === selectedId ? "현재 선택 ✓" : "선택 →"}</span>
              </span>
            </Button>
          </li>
        ))}
      </ul>
    </section>
  );
}

function ClassifiedBooks(props: Parameters<typeof BookList>[0]) {
  const labels = { school: "학교 전용", common: "공통 자료", unclassified: "학교 미분류" } as const;
  return <>{(Object.keys(labels) as (keyof typeof labels)[]).map(group => <BookList {...props}
    key={group} title={`${props.title} — ${labels[group]}`}
    options={props.options.filter(({ dataset }) => datasetSchoolGroup(dataset) === group)} />)}</>;
}

export function AssignmentDatasetPicker({
  filters, buttons, recent, remaining, resultCount, selectedId, searchRef,
  onQuery, onStage, onKind, onGrade, onSchool, onClear, onSelect, reviewOnly,
}: {
  filters: DatasetPickerFilters;
  buttons: {
    stage: readonly DatasetFilterButton<DatasetPickerFilters["stage"]>[];
    kind: readonly DatasetFilterButton<DatasetPickerFilters["kind"]>[];
    grade: readonly DatasetFilterButton[];
    school: readonly DatasetFilterButton[];
  };
  recent: readonly DatasetPickerOption[];
  remaining: readonly DatasetPickerOption[];
  resultCount: number;
  selectedId: string;
  searchRef: Ref<HTMLInputElement>;
  onQuery: (query: string) => void;
  onStage: (stage: DatasetPickerFilters["stage"]) => void;
  onKind: (kind: DatasetPickerFilters["kind"]) => void;
  onGrade: (grade: string) => void;
  onSchool: (school: string) => void;
  onClear: () => void;
  onSelect: (id: string) => void;
  reviewOnly: boolean;
}) {
  return (
    <div className={styles.picker}>
      <Field>
        <FieldLabel htmlFor="assignment-dataset-search">단어장 검색</FieldLabel>
        <Input
          autoComplete="off"
          id="assignment-dataset-search"
          maxLength={160}
          onChange={(event) => onQuery(event.target.value)}
          placeholder="단어장명·학교명·출판사·연도 검색"
          ref={searchRef}
          type="search"
          value={filters.query}
        />
      </Field>
      <FilterButtons label="학교급" options={buttons.stage} value={filters.stage} onChange={onStage} />
      <Field>
        <FieldLabel htmlFor="assignment-dataset-school">학교</FieldLabel>
        <Select id="assignment-dataset-school" value={filters.school ?? "all"} onChange={event => onSchool(event.target.value)}>
          {buttons.school.map(option => <option key={option.value} value={option.value}>{option.label} · {option.count}권</option>)}
        </Select>
      </Field>
      {filters.school?.startsWith("school:") ? <p className={styles.hint}>선택한 학교 자료와 확인된 공통 자료를 함께 표시합니다.</p> : null}
      <FilterButtons label="자료 종류" options={buttons.kind} value={filters.kind} onChange={onKind} />
      {buttons.grade.length > 1 ? (
        <FilterButtons label="학년" options={buttons.grade} value={filters.grade} onChange={onGrade} />
      ) : null}
      {reviewOnly ? <p className={styles.hint}>이 학생에게 미배정 오답이 있는 단어장만 표시합니다.</p> : null}
      <div className={styles.resultHeading}>
        <p aria-live="polite" role="status">검색 결과 {resultCount}권</p>
        <Button onClick={onClear} size="small" variant="quiet">검색·필터 초기화</Button>
      </div>
      {resultCount === 0 ? (
        <p className={styles.empty}>조건에 맞는 단어장이 없습니다. 검색어나 필터를 바꿔 주세요.</p>
      ) : (
        <>
          <ClassifiedBooks title="최근 선택" options={recent} selectedId={selectedId} onSelect={onSelect} />
          <ClassifiedBooks title={recent.length ? "그 외 단어장" : "단어장 목록"} options={remaining} selectedId={selectedId} onSelect={onSelect} />
        </>
      )}
    </div>
  );
}
