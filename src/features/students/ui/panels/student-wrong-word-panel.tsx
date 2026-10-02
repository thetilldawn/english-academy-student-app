"use client";

import { Tabs } from "@/design-system/primitives/tabs/tabs";
import { Field, FieldLabel, Select } from "@/design-system/primitives/form/field";
import { useMemo, useState } from "react";
import { toast } from "sonner";
import { announceAdminPrivateCacheChange } from "@/features/session/public-client";

import { WrongWordRequestError } from "../../api/wrong-word-transport";
import type { AdminMistakePageView } from "../../contracts/mistake-episode";
import { HelpTip, inlineHelpClassName } from "@/design-system/primitives/tooltip/help-tip";
import { adminStudentsText } from "@/content/ko/admin-students";
import { formatContentText } from "@/content/format";
import { Button } from "@/design-system/primitives/button/button";
import { Notice } from "@/design-system/patterns/feedback/feedback";
import type { ReadingCurriculumStage } from "@/lib/admin/reading-curriculum";

import { useStudentWrongWordActions } from "../../controller/use-student-wrong-word-actions";
import { useStudentMistakeHistory } from "../../controller/use-student-mistake-history";
import { useStudentMistakeSelection } from "../../controller/use-student-mistake-selection";
import styles from "./student-wrong-word-panel.module.css";
import { WrongWordControlSection } from "./wrong-word-control-section";
import { WrongWordFilterSection } from "./wrong-word-filter-section";
import { MistakeList } from "./mistake-list";
import { WrongWordPurposeSection } from "./wrong-word-purpose-section";
import { WrongWordSelectionControls } from "./wrong-word-selection-controls";

export function StudentWrongWordPanel({
  active,
  cachedAt,
  cachedHistory,
  initialDatasetId = "",
  initialCurriculumStage = "undecided",
  initialReadingContextSyncStatus = "not_synced",
  onDataUpdated,
  onLoaded,
  studentId,
}: {
  active: boolean;
  cachedAt: number | null;
  cachedHistory: AdminMistakePageView | null;
  initialDatasetId?: string;
  initialCurriculumStage?: ReadingCurriculumStage;
  initialReadingContextSyncStatus?:
    | "not_synced"
    | "not_configured"
    | "synced"
    | "failed";
  onDataUpdated?: () => void;
  onLoaded: (
    studentId: string,
    history: AdminMistakePageView | null,
  ) => void;
  studentId: string;
}) {
  const selection = useStudentMistakeSelection({ history: cachedHistory, initialDatasetId, studentId });
  const page = useStudentMistakeHistory({ active, cachedAt, cachedHistory,
    filters: selection.filters,
    loadErrorMessage: adminStudentsText.learning.wrongWordsPanel.loadError, onLoaded, studentId });
  const { error, isRequesting, loading } = page;
  const history = page.history;
  function refreshHistory() { selection.actions.clearSelections(); page.refresh(); }
  const {
    busy,
    cancelDraft,
    cancellingDraftId,
    queueing,
    queueWords,
    requestWorksheet,
    worksheetRequesting,
  } = useStudentWrongWordActions({
    cancelErrorMessage:
      adminStudentsText.learning.wrongWordsPanel.cancelDraftError,
    isHistoryRequesting: isRequesting,
    loading,
    queueErrorMessage: adminStudentsText.learning.wrongWordsPanel.queueError,
    studentId,
    worksheetErrorMessage:
      adminStudentsText.learning.wrongWordsPanel.worksheetError,
  });
  const [readingCurriculumStage, setReadingCurriculumStage] =
    useState<ReadingCurriculumStage>(initialCurriculumStage);
  const [readingContextSyncStatus, setReadingContextSyncStatus] =
    useState(initialReadingContextSyncStatus);
  const datasetLabelById = useMemo(
    () =>
      new Map(
        selection.datasetOptions.map((dataset) => [
          dataset.id,
          dataset.label,
        ]),
      ),
    [selection.datasetOptions],
  );

  const activeDrafts = history?.reviewDrafts ?? [];

  function handlePermissionFailure(error: unknown) {
    if (!(error instanceof WrongWordRequestError) || ![401,403].includes(error.status)) return false;
    announceAdminPrivateCacheChange("identity");
    selection.actions.clearSelections(); page.lock(); return true;
  }

  async function queueSelectedWords() {
    if (page.invalidated || page.locked || isRequesting()) return;
    try {
      const queueIds = await queueWords(
        selection.selectedQueuedTargets,
      );
      if (!queueIds) return;
      toast.success(
        formatContentText(
          adminStudentsText.learning.wrongWordsPanel.queueSuccess,
          { count: queueIds.length },
        ),
      );
      selection.actions.clearQueuedSelection();
      refreshHistory();
    } catch (requestError) {
      if (handlePermissionFailure(requestError)) return;
      toast.error(
        requestError instanceof Error
          ? requestError.message
          : adminStudentsText.learning.wrongWordsPanel.queueError,
      );
      refreshHistory();
    }
  }

  async function createWorksheetRequest() {
    if (page.invalidated || page.locked || isRequesting()) return;
    try {
      const payload = await requestWorksheet({
        targets: selection.selectedWorksheetTargets,
        curriculumStage: readingCurriculumStage,
      });
      if (!payload) return;

      setReadingContextSyncStatus(
        payload.sync.status === "unchanged"
          ? "synced"
          : payload.sync.status,
      );
      onDataUpdated?.();
      if (payload.sync.status === "synced") {
        toast.success(
          formatContentText(
            adminStudentsText.learning.wrongWordsPanel.worksheetSuccess,
            { count: payload.request.itemCount },
          ),
        );
      } else if (payload.sync.status === "unchanged") {
        toast.info(
          adminStudentsText.learning.wrongWordsPanel.worksheetUnchanged,
        );
      } else if (payload.sync.status === "not_configured") {
        toast.warning(
          adminStudentsText.learning.wrongWordsPanel
            .worksheetDriveNotConfigured,
        );
      } else {
        toast.error(
          adminStudentsText.learning.wrongWordsPanel.worksheetDriveFailed,
        );
      }
      if (
        payload.sync.status === "synced" ||
        payload.sync.status === "unchanged"
      ) {
        selection.actions.clearWorksheetSelection();
      }
    } catch (requestError) {
      if (handlePermissionFailure(requestError)) return;
      toast.error(
        requestError instanceof Error
          ? requestError.message
          : adminStudentsText.learning.wrongWordsPanel.worksheetError,
      );
      if (requestError instanceof WrongWordRequestError && requestError.status === 409) refreshHistory();
    }
  }

  async function cancelReviewAssignmentDraft(draftId: string) {
    try {
      const payload = await cancelDraft(draftId);
      if (!payload) return;
      toast.success(
        adminStudentsText.learning.wrongWordsPanel.cancelDraftSuccess,
      );
      refreshHistory();
      onDataUpdated?.();
    } catch (requestError) {
      if (handlePermissionFailure(requestError)) return;
      toast.error(
        requestError instanceof Error
          ? requestError.message
          : adminStudentsText.learning.wrongWordsPanel.cancelDraftError,
      );
      refreshHistory();
    }
  }

  if (page.locked) return <Notice tone="danger" role="alert">관리자 로그인을 다시 확인해 주세요.</Notice>;

  return (
    <section className={styles.panel}>
      <div className={styles.refreshRow}>
        {loading ? (
          <span>{adminStudentsText.learning.wrongWordsPanel.refreshing}</span>
        ) : (
          <span className={inlineHelpClassName}>
            <HelpTip
              label={
                adminStudentsText.learning.wrongWordsPanel.refreshBasisHelpAria
              }
              trigger={adminStudentsText.learning.wrongWordsPanel.refreshBasis}
            >
              {adminStudentsText.learning.wrongHistoryRefreshHelp}
            </HelpTip>
          </span>
        )}
        <Button
          disabled={loading || busy}
          onClick={refreshHistory}
          size="small"
          variant="quiet"
        >
          {adminStudentsText.learning.wrongWordsPanel.refresh}
        </Button>
      </div>
      {error ? (
        <Notice role="alert" tone="danger">
          {error}
        </Notice>
      ) : null}
      <Tabs ariaLabel="관리자 오답 보기" value={selection.filters.view}
        items={[{ value: "current", label: "현재 오답" }, { value: "history", label: "지난 오답 이력" }]}
        onChange={value => selection.actions.setView(value as "current" | "history")} />
      {history && <div className={styles.summaryGrid}>
        <div><span>{history.view === "current" ? "현재 오답 단어" : "이력이 있는 단어"}</span><strong>{history.summary.wordCount}개</strong></div>
        <div><span>현재 실제 오답</span><strong>{history.summary.currentWrongCount}회</strong></div>
        <div><span>누적 실제 오답</span><strong>{history.summary.lifetimeWrongCount}회</strong></div>
        <div><span>현재 시간초과·미제출</span><strong>{history.summary.currentMissedCount}회</strong></div>
        <div><span>따로 보관한 예전 기록</span><strong>{history.summary.legacyWrongCount}회</strong></div>
      </div>}
      <p className={styles.mistakeNote}>같은 단어라도 시험한 뜻이 다르면 각각 선택합니다. 현재 횟수는 마지막 해결 뒤부터, 누적 횟수는 보관된 전체 실제 오답입니다. 배정·대기 상태는 지금 기준입니다.</p>
      {activeDrafts.length > 0 && (
        <Notice>
          <p>
            {adminStudentsText.learning.wrongWordsPanel.legacyDraftNotice}
          </p>
          {activeDrafts.map((draft) => (
            <div className={styles.draftActions} key={draft.draftId}>
              <span>
                {formatContentText(
                  adminStudentsText.learning.wrongWordsPanel.draftSummary,
                  {
                    dataset:
                      datasetLabelById.get(draft.datasetId) ??
                      adminStudentsText.learning.wrongWordsPanel
                        .wordbookFallback,
                    count: draft.questionCount,
                  },
                )}
              </span>
              <Button
                aria-busy={cancellingDraftId === draft.draftId}
                disabled={
                  loading || busy
                }
                onClick={() =>
                  void cancelReviewAssignmentDraft(draft.draftId)
                }
                size="small"
                variant="quiet"
              >
                {cancellingDraftId === draft.draftId
                  ? adminStudentsText.learning.wrongWordsPanel.canceling
                  : adminStudentsText.learning.wrongWordsPanel.cancelDraft}
              </Button>
            </div>
          ))}
        </Notice>
      )}

      <p aria-live="polite">{history && !page.invalidated ? `${selection.filters.sort === "count" ? "오답 많은 순" : "최근 오답 순"} · ${history.totalCount}개 중 ${history.items.length}개 표시` : "선택한 조건의 목록을 다시 확인해 주세요."}</p>
      <div id="wrong-word-aggregate-panel">
        <WrongWordFilterSection
          view={selection.filters.view}
          datasetFilter={selection.datasetFilter}
          datasetOptions={selection.datasetOptions}
          levelFilter={selection.levelFilter}
          onDatasetFilterChange={selection.actions.setDatasetFilter}
          onLevelFilterChange={selection.actions.changeLevelFilter}
          onQueryChange={selection.actions.setQuery}
          query={selection.query}
        />
        <Field as="label"><FieldLabel as="span">정렬</FieldLabel><Select value={selection.filters.sort} onChange={event => selection.actions.setSort(event.target.value as "count" | "recent")}><option value="count">오답 많은 순</option><option value="recent">최근 오답 순</option></Select></Field>
        <WrongWordPurposeSection
          onChange={selection.actions.setPurpose}
          value={selection.purpose}
        />
        <WrongWordControlSection
          selection
          title={adminStudentsText.learning.wrongWordsPanel.sections.selection}
          titleId="wrong-word-selection-title"
        >
          <WrongWordSelectionControls
            allVisibleSelected={selection.allVisibleSelected}
            busy={busy}
            curriculumStage={readingCurriculumStage}
            loading={loading || page.invalidated}
            onCreateWorksheet={() => void createWorksheetRequest()}
            onCurriculumStageChange={setReadingCurriculumStage}
            onQueueWords={() => void queueSelectedWords()}
            onToggleVisible={() => {
              if (isRequesting() || busy || page.invalidated) return;
              selection.actions.toggleVisible();
            }}
            purpose={selection.purpose}
            queueing={queueing}
            readingContextSyncStatus={readingContextSyncStatus}
            selectableCount={selection.selectableIds.length}
            selectedCount={selection.selectedIds.length}
            worksheetRequesting={worksheetRequesting}
          />
          {!page.history || page.invalidated ? <Notice role="status">{loading ? "선택한 조건의 오답 단어를 불러오는 중…" : "목록을 확인하지 못했습니다. 다시 불러와 주세요."}</Notice> : <MistakeList
            studentId={studentId}
            onInvalidated={status => { selection.actions.clearSelections(); if (status === 401 || status === 403) page.lock(); else page.refresh(); }}
            view={selection.filters.view}
            datasetFilter={selection.datasetFilter}
            disabled={loading || busy || page.invalidated}
            onToggleQuestion={(questionId) => {
              if (isRequesting() || busy || page.invalidated) return;
              selection.actions.toggleQuestion(questionId);
            }}
            purpose={selection.purpose}
            selectedQuestionIds={selection.selectedIds}
            worksheetSelectionLimitReached={
              selection.worksheetSelectionLimitReached
            }
            words={selection.filteredWords}
          />}
        </WrongWordControlSection>
        {page.canLoadMore && <Button disabled={loading || busy} onClick={page.loadMore}>{page.loadingMore ? "불러오는 중…" : "10개 더 보기"}</Button>}
      </div>
    </section>
  );
}
