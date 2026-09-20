"use client";
import { useEffect, useRef } from "react";
import { Button } from "@/design-system/primitives/button/button";
import { DialogBody, DialogFooter, DialogFrame, DialogHeader } from "@/design-system/primitives/dialog/dialog";
import { Field, FieldError, FieldHelp, FieldLabel, Input, Select } from "@/design-system/primitives/form/field";
import type { TemplateMetadata } from "../contracts/library";
import { gradeLabel } from "../domain/library-editor";
import styles from "./wordbook-library.module.css";

export function LibraryTargetFields({ value, onChange, disabled, errors }: { value: TemplateMetadata; onChange: (m: TemplateMetadata) => void; disabled: boolean; errors: Record<string, string> }) {
  return <>
    <Field><FieldLabel htmlFor="library-meta-purpose">용도 (선택)</FieldLabel><Input id="library-meta-purpose" disabled={disabled} value={value.purpose ?? ""} maxLength={240}
      placeholder="예: 직전 대비, 유형별 학습" onChange={e => onChange({ ...value, purpose: e.target.value || null })} />
      <FieldHelp>직전 대비에는 교과서와 모의고사 등 여러 자료를 함께 넣을 수 있습니다.</FieldHelp></Field>
    <details open={!!(value.school || value.assessment || value.targetGrade || value.schoolYear || value.semester) || undefined}><summary>학교 시험의 대상 지정 (선택)</summary>
      <div className={styles.metadata}>
        <Field><FieldLabel htmlFor="library-meta-school">학교</FieldLabel><Input id="library-meta-school" disabled={disabled} value={value.school ?? ""} maxLength={240} onChange={e => onChange({ ...value, school: e.target.value || null })} /></Field>
        <Field><FieldLabel htmlFor="library-meta-targetGrade">사용 대상 학년</FieldLabel><Select id="library-meta-targetGrade" disabled={disabled} value={value.targetGrade ?? ""} onChange={e => onChange({ ...value, targetGrade: e.target.value || null })}>
          <option value="">지정 안 함</option>{["g7", "g8", "g9", "g10", "g11", "g12"].map(v => <option key={v} value={v}>{gradeLabel(v)}</option>)}
          {value.targetGrade && !/^g(7|8|9|10|11|12)$/.test(value.targetGrade) ? <option value={value.targetGrade}>{value.targetGrade}</option> : null}
        </Select></Field>
        <Field><FieldLabel htmlFor="library-school-year">시험 준비 연도</FieldLabel><Input id="library-school-year" type="number" min={2000} max={2100} value={value.schoolYear ?? ""} disabled={disabled}
          aria-invalid={!!errors.schoolYear} aria-describedby={errors.schoolYear ? "library-year-error" : undefined} onChange={e => onChange({ ...value, schoolYear: e.target.value ? Number(e.target.value) : null })} />
          {errors.schoolYear ? <FieldError id="library-year-error">{errors.schoolYear}</FieldError> : null}</Field>
        <Field><FieldLabel htmlFor="library-semester">학기</FieldLabel><Select id="library-semester" value={value.semester ?? ""} disabled={disabled} onChange={e => onChange({ ...value, semester: e.target.value ? Number(e.target.value) as 1 | 2 : null })}>
          <option value="">지정 안 함</option><option value="1">1학기</option><option value="2">2학기</option></Select></Field>
        <Field><FieldLabel htmlFor="library-meta-assessment">시험</FieldLabel><Input id="library-meta-assessment" disabled={disabled} value={value.assessment ?? ""} maxLength={240} placeholder="예: 기말고사" onChange={e => onChange({ ...value, assessment: e.target.value || null })} /></Field>
      </div>
    </details>
  </>;
}

export function LibraryDiscardDialog({ onCancel, onDiscard }: { onCancel: () => void; onDiscard: () => void }) {
  const cancel = useRef<HTMLButtonElement>(null);
  useEffect(() => { cancel.current?.focus({ preventScroll: true }); }, []);
  return <DialogFrame role="alertdialog" size="compact" layout="body-footer" aria-labelledby="library-discard-title" aria-describedby="library-discard-description" onRequestClose={onCancel}>
    <DialogHeader closeLabel="계속 작성" showCloseButton={false}><h2 id="library-discard-title">작성 중인 구성을 닫을까요?</h2></DialogHeader>
    <DialogBody><p id="library-discard-description">아직 저장하지 않은 변경 내용이 있습니다.</p></DialogBody>
    <DialogFooter><Button ref={cancel} onClick={onCancel}>계속 작성</Button><Button variant="danger" onClick={onDiscard}>변경 내용을 버리고 이동</Button></DialogFooter>
  </DialogFrame>;
}
