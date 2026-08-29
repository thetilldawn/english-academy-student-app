"use client";

import { useMemo, useState } from "react";
import { toast } from "sonner";

import type { StudentWrongWordHistory } from "@/lib/admin/wrong-word-history";
import { HelpTip, inlineHelpClassName } from "@/design-system/primitives/tooltip/help-tip";
import { adminStudentsText } from "@/content/ko/admin-students";
import { formatContentText } from "@/content/format";
import { Button } from "@/design-system/primitives/button/button";
import { Notice } from "@/design-system/patterns/feedback/feedback";
import type { ReadingCurriculumStage } from "@/lib/admin/reading-curriculum";

import { useStudentWrongWordActions } from "../../controller/use-student-wrong-word-actions";
import { useStudentWrongWordHistory } from "../../controller/use-student-wrong-word-history";
import {
  activeWrongWordReviewDrafts,
  filterWrongWords,
  keepSelectableQuestionIds,
  selectableWrongWordQuestionIds,
  wrongWordDatasetOptions,
  type WrongWordLevelFilter,
  type WrongWordSelectionPurpose,
} from "../../domain/wrong-word-selection";
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
  cachedHistory: StudentWrongWordHistory | null;
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
    history: StudentWrongWordHistory,
  ) => void;
  studentId: string;
}) {
  const {
    error,
    isRequesting,
    loading,
    refresh: refreshHistory,
  } = useStudentWrongWordHistory({
    active,
    cachedAt,
    cachedHistory,
    loadErrorMessage: adminStudentsText.learning.wrongWordsPanel.loadError,
    onLoaded,
    studentId,
  });
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
  const [levelFilter, setLevelFilter] =
    useState<WrongWordLevelFilter>("all");
  const [datasetFilter, setDatasetFilter] = useState(initialDatasetId);
  const [query, setQuery] = useState("");
  const [selectedQuestionIds, setSelectedQuestionIds] = useState<
    string[]
  >([]);
  const [worksheetSelectedQuestionIds, setWorksheetSelectedQuestionIds] =
    useState<string[]>([]);
  const [selectionPurpose, setSelectionPurpose] =
    useState<WrongWordSelectionPurpose>("next_exam");
  const [readingCurriculumStage, setReadingCurriculumStage] =
    useState<ReadingCurriculumStage>(initialCurriculumStage);
  const [readingContextSyncStatus, setReadingContextSyncStatus] =
    useState(initialReadingContextSyncStatus);

  const datasetOptions = useMemo(
    () => wrongWordDatasetOptions(cachedHistory),
    [cachedHistory],
  );
  const datasetLabelById = useMemo(
    () =>
      new Map(
        datasetOptions.map((dataset) => [
          dataset.id,
          dataset.label,
        ]),
      ),
    [datasetOptions],
  );

  const activeDrafts = useMemo(
    () => activeWrongWordReviewDrafts(cachedHistory),
    [cachedHistory],
  );

  const filteredWords = useMemo(
    () => filterWrongWords({
      history: cachedHistory,
      datasetId: datasetFilter,
      level: levelFilter,
      query,
    }),
    [cachedHistory, datasetFilter, levelFilter, query],
  );

  const selectableFilteredQuestionIds = useMemo(
    () => selectableWrongWordQuestionIds({
      words: filteredWords,
      datasetId: datasetFilter,
      purpose: "next_exam",
      }),
    [datasetFilter, filteredWords],
  );
  const validSelectedQuestionIds = useMemo(
    () => keepSelectableQuestionIds(
      selectedQuestionIds,
      selectableFilteredQuestionIds,
    ),
    [selectableFilteredQuestionIds, selectedQuestionIds],
  );
  const worksheetSelectableFilteredQuestionIds = useMemo(
    () => selectableWrongWordQuestionIds({
      words: filteredWords,
      datasetId: datasetFilter,
      purpose: "worksheet",
      }),
    [datasetFilter, filteredWords],
  );
  const validWorksheetSelectedQuestionIds = useMemo(
    () => keepSelectableQuestionIds(
      worksheetSelectedQuestionIds,
      worksheetSelectableFilteredQuestionIds,
    ),
    [
      worksheetSelectableFilteredQuestionIds,
      worksheetSelectedQuestionIds,
    ],
  );
  const activeSelectableQuestionIds =
    selectionPurpose === "next_exam"
      ? selectableFilteredQuestionIds
      : worksheetSelectableFilteredQuestionIds.slice(0, 50);
  const activeSelectedQuestionIds =
    selectionPurpose === "next_exam"
      ? validSelectedQuestionIds
      : validWorksheetSelectedQuestionIds;
  const allVisibleSelected =
    activeSelectableQuestionIds.length > 0 &&
    activeSelectableQuestionIds.every((questionId) =>
      activeSelectedQuestionIds.includes(questionId),
    );

  function toggleQuestion(questionId: string) {
    if (
      isRequesting() ||
      busy
    ) {
      return;
    }
    if (selectionPurpose === "next_exam") {
      setSelectedQuestionIds((current) =>
        current.includes(questionId)
          ? current.filter((value) => value !== questionId)
          : [...current, questionId],
      );
      return;
    }
    setWorksheetSelectedQuestionIds((current) =>
      current.includes(questionId)
        ? current.filter((value) => value !== questionId)
        : current.length < 50
          ? [...current, questionId]
          : current,
    );
  }

  function toggleVisibleQuestions() {
    if (
      isRequesting() ||
      busy
    ) {
      return;
    }
    if (selectionPurpose === "next_exam") {
      setSelectedQuestionIds(
        allVisibleSelected ? [] : selectableFilteredQuestionIds,
      );
      return;
    }
    setWorksheetSelectedQuestionIds(
      allVisibleSelected ? [] : activeSelectableQuestionIds,
    );
  }

  function resetSelectionFeedback() {
    setSelectedQuestionIds([]);
    setWorksheetSelectedQuestionIds([]);
  }

  async function queueSelectedWords() {
    try {
      const queueIds = await queueWords(
        validSelectedQuestionIds,
      );
      if (!queueIds) return;
      toast.success(
        formatContentText(
          adminStudentsText.learning.wrongWordsPanel.queueSuccess,
          { count: queueIds.length },
        ),
      );
      setSelectedQuestionIds([]);
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
    try {
      const payload = await requestWorksheet({
        questionIds: validWorksheetSelectedQuestionIds,
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
        setWorksheetSelectedQuestionIds([]);
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

  if (loading && !cachedHistory) {
    return (
      <section
        aria-busy="true"
        className={`${styles.emptyPanel} ${styles.panel}`}
      >
        {adminStudentsText.learning.wrongWordsPanel.loading}
      </section>
    );
  }

  if (error && !cachedHistory) {
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

  if (!cachedHistory) {
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
              { count: cachedHistory.wrongEventCount },
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
              { count: cachedHistory.uniqueWordCount },
            )}
          </strong>
        </div>
        <div>
          <span>{adminStudentsText.learning.wrongWordsPanel.summary.once}</span>
          <strong>
            {formatContentText(
              adminStudentsText.learning.wrongWordsPanel.summary.count,
              { count: cachedHistory.onceWrongWordCount },
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
              { count: cachedHistory.repeatedWrongWordCount },
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
              { count: cachedHistory.pendingReviewCount },
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
                    count: draft.questionIds.length,
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

      <div id="wrong-word-aggregate-panel">
        <WrongWordFilterSection
          datasetFilter={datasetFilter}
          datasetOptions={datasetOptions}
          levelFilter={levelFilter}
          onDatasetFilterChange={(value) => {
            setDatasetFilter(value);
            resetSelectionFeedback();
          }}
          onLevelFilterChange={(value) => {
            if (levelFilter === value) return;
            setLevelFilter(value);
            resetSelectionFeedback();
          }}
          onQueryChange={(value) => {
            setQuery(value);
            resetSelectionFeedback();
          }}
          query={query}
        />
        <WrongWordPurposeSection
          onChange={setSelectionPurpose}
          value={selectionPurpose}
        />
        <WrongWordControlSection
          selection
          title={adminStudentsText.learning.wrongWordsPanel.sections.selection}
          titleId="wrong-word-selection-title"
        >
          <WrongWordSelectionControls
            allVisibleSelected={allVisibleSelected}
            busy={busy}
            curriculumStage={readingCurriculumStage}
            loading={loading}
            onCreateWorksheet={() => void createWorksheetRequest()}
            onCurriculumStageChange={setReadingCurriculumStage}
            onQueueWords={() => void queueSelectedWords()}
            onToggleVisible={toggleVisibleQuestions}
            purpose={selectionPurpose}
            queueing={queueing}
            readingContextSyncStatus={readingContextSyncStatus}
            selectableCount={activeSelectableQuestionIds.length}
            selectedCount={activeSelectedQuestionIds.length}
            worksheetRequesting={worksheetRequesting}
          />
          <WrongWordList
            datasetFilter={datasetFilter}
            disabled={loading || busy}
            onToggleQuestion={toggleQuestion}
            purpose={selectionPurpose}
            selectedQuestionIds={activeSelectedQuestionIds}
            worksheetSelectionLimitReached={
              validWorksheetSelectedQuestionIds.length >= 50
            }
            words={filteredWords}
          />
        </WrongWordControlSection>
      </div>
    </section>
  );
}
