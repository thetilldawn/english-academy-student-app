"use client";

import { useMemo, useState } from "react";
import { toast } from "sonner";

import type { WrongWordPageView } from "../../contracts/wrong-word-page";
import { HelpTip, inlineHelpClassName } from "@/design-system/primitives/tooltip/help-tip";
import { adminStudentsText } from "@/content/ko/admin-students";
import { formatContentText } from "@/content/format";
import { Button } from "@/design-system/primitives/button/button";
import { Notice } from "@/design-system/patterns/feedback/feedback";
import type { ReadingCurriculumStage } from "@/lib/admin/reading-curriculum";

import { useStudentWrongWordActions } from "../../controller/use-student-wrong-word-actions";
import { useStudentWrongWordHistory } from "../../controller/use-student-wrong-word-history";
import { useWrongWordPanelSelection } from "../../controller/use-wrong-word-panel-selection";
import styles from "./student-wrong-word-panel.module.css";
import { WrongWordControlSection } from "./wrong-word-control-section";
import { WrongWordFilterSection } from "./wrong-word-filter-section";
import { WrongWordList } from "./wrong-word-list";
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
  cachedHistory: WrongWordPageView | null;
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
    history: WrongWordPageView | null,
  ) => void;
  studentId: string;
}) {
  const selection = useWrongWordPanelSelection({ history: cachedHistory, initialDatasetId });
  const page = useStudentWrongWordHistory({ active, cachedAt, cachedHistory,
    filters: { datasetId: selection.datasetFilter, level: selection.levelFilter, query: selection.query },
    loadErrorMessage: adminStudentsText.learning.wrongWordsPanel.loadError, onLoaded, studentId });
  const { error, isRequesting, loading } = page;
  const history = page.history ?? cachedHistory;
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

  async function queueSelectedWords() {
    if (page.invalidated || page.locked || isRequesting()) return;
    try {
      const queueIds = await queueWords(
        selection.selectedQueuedIds,
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
        questionIds: selection.selectedWorksheetIds,
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
      toast.error(
        requestError instanceof Error
          ? requestError.message
          : adminStudentsText.learning.wrongWordsPanel.worksheetError,
      );
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
      toast.error(
        requestError instanceof Error
          ? requestError.message
          : adminStudentsText.learning.wrongWordsPanel.cancelDraftError,
      );
    }
  }

  if (page.locked) return <Notice tone="danger" role="alert">관리자 로그인을 다시 확인해 주세요.</Notice>;

  if (loading && !history) {
    return (
      <section
        aria-busy="true"
        className={`${styles.emptyPanel} ${styles.panel}`}
      >
        {adminStudentsText.learning.wrongWordsPanel.loading}
      </section>
    );
  }

  if (error && !history) {
    return (
      <section className={styles.panel}>
        <Notice role="alert" tone="danger">
          {error}
        </Notice>
        <Button
          onClick={refreshHistory}
        >
          {adminStudentsText.learning.wrongWordsPanel.retryLoad}
        </Button>
      </section>
    );
  }

  if (!history) {
    return (
      <section className={`${styles.emptyPanel} ${styles.panel}`}>
        {adminStudentsText.learning.wrongWordsPanel.openToLoad}
      </section>
    );
  }

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
      <div className={styles.summaryGrid}>
        <div>
          <span>{adminStudentsText.learning.wrongWordsPanel.summary.event}</span>
          <strong>
            {formatContentText(
              adminStudentsText.learning.wrongWordsPanel.summary.times,
              { count: history.summary.wrongEventCount },
            )}
          </strong>
        </div>
        <div>
          <span>
            {adminStudentsText.learning.wrongWordsPanel.summary.current}
          </span>
          <strong>
            {formatContentText(
              adminStudentsText.learning.wrongWordsPanel.summary.count,
              { count: history.summary.uniqueWordCount },
            )}
          </strong>
        </div>
        <div>
          <span>{adminStudentsText.learning.wrongWordsPanel.summary.once}</span>
          <strong>
            {formatContentText(
              adminStudentsText.learning.wrongWordsPanel.summary.count,
              { count: history.summary.onceWrongWordCount },
            )}
          </strong>
        </div>
        <div>
          <span>
            {adminStudentsText.learning.wrongWordsPanel.summary.repeated}
          </span>
          <strong>
            {formatContentText(
              adminStudentsText.learning.wrongWordsPanel.summary.count,
              { count: history.summary.repeatedWrongWordCount },
            )}
          </strong>
        </div>
        <div>
          <span>
            {adminStudentsText.learning.wrongWordsPanel.summary.pending}
          </span>
          <strong>
            {formatContentText(
              adminStudentsText.learning.wrongWordsPanel.summary.count,
              { count: history.summary.pendingReviewCount },
            )}
          </strong>
        </div>
      </div>
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

      <p aria-live="polite">{page.history && !page.invalidated ? `최신순 · ${history.totalCount}개 중 ${history.items.length}개 표시` : "선택한 조건의 목록을 다시 확인해 주세요."}</p>
      <div id="wrong-word-aggregate-panel">
        <WrongWordFilterSection
          datasetFilter={selection.datasetFilter}
          datasetOptions={selection.datasetOptions}
          levelFilter={selection.levelFilter}
          onDatasetFilterChange={selection.actions.setDatasetFilter}
          onLevelFilterChange={selection.actions.changeLevelFilter}
          onQueryChange={selection.actions.setQuery}
          query={selection.query}
        />
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
          {!page.history ? <Notice role="status">{loading ? "선택한 조건의 오답 단어를 불러오는 중…" : "목록을 확인하지 못했습니다. 다시 불러와 주세요."}</Notice> : <WrongWordList
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
