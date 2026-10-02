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
  diagnosis?: { candidateCount?: number; wrongEligible: number; unavailableItems?: DirectReviewUnavailableItem[]; banks?: {questionCount:number;quizContentMode:string;englishToKoreanRatio:number}[] };
  confirmed?: boolean; onConfirm?: (value: boolean) => void;
}) {
  const unavailable = diagnosis?.unavailableItems ?? [];
  return <><dl className={styles.reviewPreview}>
    {rows.map((row) => <div key={row.label}><dt>{row.label}</dt><dd>{row.value}</dd></div>)}
  </dl>
  {diagnosis?.banks && diagnosis.banks.length > 1 && <Notice tone="warning"><p>뜻과 문제 종류를 보존하기 위해 별도 시험 {diagnosis.banks.length}개로 배정합니다. 통과 여부와 포인트는 각 시험별로 계산합니다. 전체 제한시간은 문항 수에 따라 나누며, 시험마다 최소 30초가 필요합니다.</p><p>{diagnosis.banks.map((bank,index)=>`시험 ${index+1}: ${bank.questionCount}문항`).join(" · ")}</p></Notice>}
  {unavailable.length > 0 && diagnosis && <Notice tone="warning">
    <p>대상 {diagnosis.candidateCount}개 · 출제 가능 {diagnosis.wrongEligible}개 · 제외 {unavailable.length}개</p>
    <ul>{unavailable.map(item => <li key={item.sourceQuestionId}><strong>{item.headword}</strong>{item.primaryMeaning ? ` (${item.primaryMeaning})` : ""} — {reasonText[item.reason]}</li>)}</ul>
    {diagnosis.wrongEligible > 0 ? <label><Checkbox checked={confirmed} onChange={event => onConfirm?.(event.target.checked)} /> 제외 {unavailable.length}개를 확인하고 {diagnosis.wrongEligible}개로 배정</label>
      : <p>현재 조건으로 출제할 수 있는 단어가 없습니다. 출제 방향이나 자료를 다시 확인해 주세요.</p>}
  </Notice>}
  </>;
}
