import type { DirectReviewPreviewRow } from "../presentation/direct-review-view";
import type { DirectReviewUnavailableItem } from "../domain/direct-review-diagnosis";
import { Notice } from "@/design-system/patterns/feedback/feedback";
import { Checkbox } from "@/design-system/primitives/form/field";
import styles from "./vocab-assignment-planner.module.css";

const reasonText: Record<DirectReviewUnavailableItem["reason"], string> = {
  target_unavailable: "현재 출제할 수 있는 문제가 없습니다.", identity_changed: "단어의 사전 연결이 바뀌었습니다.",
  direction_unavailable: "선택한 출제 방향의 문제가 없습니다.", insufficient_choices: "서로 다른 보기 4개를 구성할 수 없습니다.",
};
export function DirectReviewPreview({ rows, diagnosis, confirmed = false, onConfirm }: {
  rows: readonly DirectReviewPreviewRow[];
  diagnosis?: { candidateCount?: number; wrongEligible: number; unavailableItems?: DirectReviewUnavailableItem[] };
  confirmed?: boolean; onConfirm?: (value: boolean) => void;
}) {
  const unavailable = diagnosis?.unavailableItems ?? [];
  return <><dl className={styles.reviewPreview}>
    {rows.map((row) => <div key={row.label}><dt>{row.label}</dt><dd>{row.value}</dd></div>)}
  </dl>
  {unavailable.length > 0 && diagnosis && <Notice tone="warning">
    <p>대상 {diagnosis.candidateCount}개 · 출제 가능 {diagnosis.wrongEligible}개 · 제외 {unavailable.length}개</p>
    <ul>{unavailable.map(item => <li key={item.sourceQuestionId}><strong>{item.headword}</strong>{item.primaryMeaning ? ` (${item.primaryMeaning})` : ""} — {reasonText[item.reason]}</li>)}</ul>
    {diagnosis.wrongEligible > 0 ? <label><Checkbox checked={confirmed} onChange={event => onConfirm?.(event.target.checked)} /> 제외 {unavailable.length}개를 확인하고 {diagnosis.wrongEligible}개로 배정</label>
      : <p>현재 조건으로 출제할 수 있는 단어가 없습니다. 출제 방향이나 자료를 다시 확인해 주세요.</p>}
  </Notice>}
  </>;
}
