import { RouteLoadingState } from "@/design-system/patterns/route-state/route-state";
import type { AssignmentUnitItem } from "../catalog-types";
import { mixedMistakeFieldKey, type MixedMistakeAssignmentController } from "../controller/use-mixed-mistake-assignment-controller";
import type { ExamSettings } from "../domain/model";
import type { AssignmentDatasetTriggerProps } from "./assignment-dataset-trigger";
import { AssignmentSection } from "./assignment-section";
import { VocabRangeFields } from "./vocab-range-fields";
import { ExamConditionFields, ExamQuestionOrderField } from "./exam-condition-fields";
import { ExamTimingFields } from "./exam-timing-fields";
import { AssignmentDeadlineFields } from "./assignment-deadline-fields";
import { Notice } from "@/design-system/patterns/feedback/feedback";
import { Button } from "@/design-system/primitives/button/button";
import { Checkbox, Field, FieldError, FieldLabel } from "@/design-system/primitives/form/field";
import { NumericInput } from "@/design-system/primitives/form/numeric-input";
import styles from "./vocab-assignment-planner.module.css";

export function MixedMistakeAssignmentSections({ controller, units, showErrors, onOpenDatasetPicker, datasetTriggerRef, unitLoadState, onRetryUnits }: {
  controller: MixedMistakeAssignmentController; units: readonly AssignmentUnitItem[]; showErrors: boolean;
  onOpenDatasetPicker: () => void; datasetTriggerRef?: AssignmentDatasetTriggerProps["triggerRef"];
  unitLoadState: { datasetId: string; status: "idle" | "loading" | "ready" | "error"; message: string }; onRetryUnits: () => void;
}) {
  const { draft, value, preview, dispatch } = controller;
  const dataset = controller.datasetOptions.find(item => item.id === draft.range.datasetId);
  const selectedUnits = units.filter(unit => unit.datasetId === draft.range.datasetId).toSorted((a, b) => a.sortIndex - b.sortIndex);
  const errors = Object.fromEntries(showErrors ? controller.issues.map(issue => [mixedMistakeFieldKey(issue.path), issue.message]) : []);
  const changeExam = (change: Partial<ExamSettings>) => dispatch({ type: "exam/changed", exam: { ...draft.exam, ...change } });
  return <div className={styles.plannerSections}>
    <AssignmentSection index={1} title="일반 단어 범위" help="선택한 범위에 미해결 오답을 더합니다. 같은 뜻은 한 번만 포함하고 남은 문항을 범위 순서대로 채웁니다." helpLabel="범위와 오답 선택 설명">
      <VocabRangeFields dataset={dataset} units={selectedUnits} selectedUnitIds={draft.range.orderedUnitIds}
        datasetError={errors.dataset} rangeError={errors.range} onSelectUnit={controller.toggleUnit} onToggleAllUnits={controller.toggleAllUnits}
        onOpenDatasetPicker={onOpenDatasetPicker} datasetTriggerRef={datasetTriggerRef} />
      {unitLoadState.status === "loading" ? <RouteLoadingState variant="compact" label="시험 범위를 불러오고 있습니다." /> : null}
      {unitLoadState.status === "error" ? <Notice tone="danger" role="alert"><p>{unitLoadState.message}</p><Button onClick={onRetryUnits}>범위 다시 불러오기</Button></Notice> : null}
      {controller.datasetOptions.length === 0 ? <p role="status">현재 혼합 배정에 사용할 수 있는 단어장이 없습니다.</p> : null}
      <Field data-field-key="reviewLevels" tabIndex={-1}>
        <FieldLabel as="span">포함할 오답</FieldLabel>
        <div className={styles.modeButtons}>
          {([1, 2] as const).map(level => <label key={level}><Checkbox checked={draft.review.levels.includes(level)} onChange={event => dispatch({ type: "review/changed",
            review: { mode: "pending", scope: draft.review.scope, levels: event.target.checked ? [...draft.review.levels, level].toSorted() : draft.review.levels.filter(item => item !== level) } })} />{level}회 오답</label>)}
        </div>
        {errors.reviewLevels ? <FieldError>{errors.reviewLevels}</FieldError> : null}
        <div className={styles.modeButtons} role="group" aria-label="오답을 가져올 범위">
          {([['dataset', '이 단어장 전체'], ['selection', '선택한 범위만']] as const).map(([scope, label]) => <Button key={scope} variant="filter" size="small" aria-pressed={draft.review.scope === scope}
            onClick={() => dispatch({ type: "review/changed", review: { mode: "pending", scope, levels: draft.review.levels } })}>{label}</Button>)}
        </div>
        <p>이미 배정된 오답과 해결한 오답은 제외됩니다. 미해결 오답부터 넣고, 남은 수만큼 일반 단어를 채웁니다.</p>
      </Field>
    </AssignmentSection>
    <AssignmentSection index={2} title="시험 조건" help="총 문항 수와 출제 방향은 나뉘는 모든 시험을 합한 기준입니다." helpLabel="혼합 시험 조건 설명">
      <Field as="label" data-field-key="questionCount"><FieldLabel as="span">총 문항 수</FieldLabel>
        <NumericInput min={4} max={500} value={draft.questionCount.value} onValueChange={value => dispatch({ type: "questionCount/manuallyChanged", value: value ?? Number.NaN })} aria-invalid={Boolean(errors.questionCount)} />
        {errors.questionCount ? <FieldError>{errors.questionCount}</FieldError> : null}
      </Field>
      <ExamQuestionOrderField value={draft.exam.questionOrderMode} error={errors.questionOrder} onChange={questionOrderMode => changeExam({ questionOrderMode })} />
      <ExamConditionFields idPrefix="mixed" exam={{ directionRatio: draft.exam.directionRatio, passingScore: draft.exam.passingScore, retryEnabled: draft.exam.retryEnabled, retryPassingScore: draft.exam.retryPassingScore }}
        fieldErrors={{ direction: errors.direction, passingScore: errors.passingScore, retryPassingScore: errors.retryPassingScore }}
        onDirectionChange={directionRatio => changeExam({ directionRatio })} onPassingScoreChange={passingScore => changeExam({ passingScore })}
        onRetryEnabledChange={retryEnabled => changeExam({ retryEnabled })}
        onRetryPassingScoreChange={retryPassingScore => changeExam({ retryPassingScore })} />
    </AssignmentSection>
    <AssignmentSection index={3} title="시험 일정" help="저장하면 바로 응시할 수 있습니다. 전체 제한시간은 각 시험의 문항 수에 따라 나누며 시험마다 최소 30초가 필요합니다." helpLabel="혼합 시험 일정 설명">
      <ExamTimingFields enabled={draft.exam.timeLimitEnabled !== false} timing={draft.exam.timing} error={errors.timing}
        onEnabledChange={timeLimitEnabled => changeExam({ timeLimitEnabled })}
        onModeChange={mode => changeExam({ timing: mode === 'total' ? { mode, totalSeconds: 300 } : { mode, perQuestionSeconds: 15 } })}
        onTimingChange={timing => changeExam({ timing })} />
      <AssignmentDeadlineFields id="mixed-deadline" deadline={draft.deadline} error={errors.deadline} onChange={deadline => dispatch({ type: "deadline/changed", deadline })} />
    </AssignmentSection>
    <AssignmentSection index={4} title="배정 미리보기" help="단어의 뜻과 원래 문제 종류를 보존하기 위해 시험이 나뉠 수 있습니다. 아래 내용대로 저장합니다." helpLabel="혼합 배정 미리보기 설명">
      <div className={styles.fieldStack} data-field-key="preview" tabIndex={-1} aria-busy={controller.calculationPending}>
        {controller.calculationPending ? <RouteLoadingState variant="compact" label="일반 단어와 오답을 함께 계산하고 있습니다." /> : null}
        {controller.message ? <Notice tone="danger" role="alert">{controller.message}</Notice> : null}
        {preview.status === "error" ? <Button onClick={controller.retryPreview}>미리보기 다시 계산</Button> : null}
        {!value && !controller.calculationPending && preview.status !== 'error' ? <p>단어장과 범위, 시험 조건을 선택하면 미리보기가 표시됩니다.</p> : null}
        {value && !controller.calculationPending ? <>
          <dl className={styles.reviewPreview}>
            <div><dt>일반 후보</dt><dd>{value.availablePrimaryCount}개</dd></div>
            <div><dt>미배정 오답</dt><dd>{value.candidateReviewCount}개 · 제외 {value.unavailableCount}개</dd></div>
            {!value.error ? <div><dt>실제 배정</dt><dd>일반 {value.primaryQuestionCount}개 + 오답 {value.reviewMeaningCount}개 = 총 {value.totalQuestionCount}문항</dd></div> : null}
          </dl>
          {value.unavailableItems.length > 0 ? <Notice tone="warning"><details><summary>제외되는 오답 {value.unavailableCount}개 확인</summary>
            <ul>{value.unavailableItems.map(item => <li key={item.key}><strong>{item.headword}</strong> — {item.reason}</li>)}</ul></details>
            {!value.error ? <label><Checkbox checked={controller.exclusionsConfirmed} onChange={event => controller.confirmExclusions(event.target.checked)} />제외되는 오답을 확인했습니다.</label> : null}
          </Notice> : null}
          {value.banks.length > 0 ? <ul>{value.banks.map(bank => <li key={bank.index}>시험 {bank.index + 1}: {bank.questionCount}문항 (일반 {bank.primaryQuestionCount} + 오답 {bank.reviewMeaningCount}) · {bank.englishToKoreanRatio === 100 ? '영어 → 뜻' : bank.englishToKoreanRatio === 0 ? '뜻 → 영어' : '두 방향 혼합'}{bank.timeLimitSeconds !== null ? ` · ${bank.timeLimitSeconds}초` : draft.exam.timeLimitEnabled === false ? ' · 시간 제한 없음' : ` · 문제당 ${draft.exam.timing.mode === 'per_question' ? draft.exam.timing.perQuestionSeconds : 0}초`}</li>)}</ul> : null}
          {value.banks.length > 1 ? <Notice tone="warning"><p>통과 여부와 포인트는 시험별로 계산합니다.</p>
            <label><Checkbox checked={controller.banksConfirmed} onChange={event => controller.confirmBanks(event.target.checked)} />시험 {value.banks.length}개로 나누어 배정하는 것을 확인했습니다.</label>
          </Notice> : null}
        </> : null}
      </div>
    </AssignmentSection>
  </div>;
}
