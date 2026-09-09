"use client";

import { useId, useLayoutEffect, useRef, useState } from "react";
import { toast } from "sonner";

import { Button } from "@/design-system/primitives/button/button";
import { useConfirmation } from "@/design-system/patterns/confirmation/confirmation";
import { announceAdminPrivateCacheChange } from "@/features/session/public-client";
import { MetaTag, MetaTagList } from "@/design-system/primitives/badge/badge";
import { unitRangeDisplayGroups } from "@/lib/admin/unit-range-display";
import {
  resolveAssignmentQueue,
  type QueueResolutionAction,
  type QueueResolutionResult,
} from "@/features/assignment-queue/api/queue-actions";
import { AssignmentQueueTags } from "@/features/assignment-queue/ui/assignment-queue-tags";
import {
  vocabAssignmentQueueItemStatusLabel,
  vocabAssignmentQueueStatusLabel,
  vocabAssignmentQueueUnitAllocationLabel,
  type VocabAssignmentQueueSummary,
} from "@/lib/admin/vocab-assignment-queue";
import { isoToKoreanDateTimeLocal } from "@/lib/deadline";

import styles from "./assignment-queue-history.module.css";
import { queueAttentionView, queueResolutionView } from "../presentation/queue-resolution-view";

function localDateTime(value: string) {
  return isoToKoreanDateTimeLocal(value).replace("T", " ");
}

function AssignmentQueueDisclosure({
  processingDisabled = false,
  onResolutionPending,
  onResolutionError,
  onResolved,
  queue,
}: {
  processingDisabled?: boolean;
  onResolutionPending?: (seriesId: string, pending: boolean) => void;
  onResolutionError?: (error: unknown) => void;
  onResolved?: (result: QueueResolutionResult) => void;
  queue: VocabAssignmentQueueSummary;
}) {
  const [open, setOpen] = useState(
    queue.status === "active" || queue.status === "attention",
  );
  const scopeKey = `${queue.seriesId}:${queue.updatedAt}:${queue.status}:${queue.items.find(item => item.status === "attention")?.id}`;
  const [resolvingScope, setResolvingScope] = useState<string | null>(null);
  const resolving = resolvingScope === scopeKey;
  const resolvingRef = useRef(false);
  const processingDisabledRef = useRef(processingDisabled);
  useLayoutEffect(() => { processingDisabledRef.current = processingDisabled; }, [processingDisabled]);
  const versionRef = useRef(0);
  const confirm = useConfirmation(scopeKey);
  useLayoutEffect(() => {
    versionRef.current += 1;
    resolvingRef.current = false;
    return () => { versionRef.current += 1; };
  }, [scopeKey]);
  const contentId = useId();
  const unitAllocation = vocabAssignmentQueueUnitAllocationLabel(
    queue.unitAllocation,
  );

  async function resolve(action: QueueResolutionAction) {
    if (resolvingRef.current || processingDisabled) return;
    const expectedItem = queue.items.find((item) => item.status === "attention");
    if (!expectedItem) {
      const error = new Error("처리할 회차를 확인하지 못했습니다. 최신 내역을 확인해 주세요.");
      onResolutionError?.(error);
      toast.error(error.message);
      return;
    }
    const confirmation = {
      retry:
        "같은 회차를 새 일정으로 다시 배정할까요? 기존 시험은 이력에 남습니다.",
      skip: "이 회차를 보류하고 다음 회차로 넘어갈까요? 기록은 남고, 다음 회차의 예약 시간과 마감은 유지됩니다.",
      cancel: "남은 시험을 모두 취소할까요? 완료 내역은 남습니다.",
    }[action];
    resolvingRef.current = true;
    const version = versionRef.current;
    setResolvingScope(scopeKey);
    let sent = false;
    try {
      if (!await confirm({ message: confirmation }) || versionRef.current !== version || processingDisabledRef.current) return;
      sent = true;
      onResolutionPending?.(queue.seriesId, true);
      const result = await resolveAssignmentQueue(queue.seriesId, action, expectedItem.id);
      // A sent command can finish after closing. Invalidate shared reads, not a new screen's state.
      announceAdminPrivateCacheChange("students");
      if (versionRef.current === version) {
        const view = queueResolutionView(result);
        if (view.warning) toast.warning(view.message);
        else toast.success(view.message);
        onResolved?.(result);
      }
    } catch (error) {
      if (versionRef.current !== version) return;
      onResolutionError?.(error);
      toast.error(
        error instanceof Error
          ? error.message
          : "배정된 시험 상태를 처리하지 못했습니다.",
      );
    } finally {
      if (sent) onResolutionPending?.(queue.seriesId, false);
      if (versionRef.current === version) {
        resolvingRef.current = false;
        setResolvingScope(null);
      }
    }
  }

  return (
    <article className={styles.queue}>
      <button
        aria-label={`${vocabAssignmentQueueStatusLabel(queue.status)} · ${queue.datasetLabel} · ${queue.rangeLabel}${unitAllocation ? ` · ${unitAllocation}` : ""} · ${queue.remainingSessionCount}회 · ${queue.remainingQuestionCount}개 남음`}
        aria-controls={contentId}
        aria-expanded={open}
        className={styles.summary}
        onClick={() => setOpen((current) => !current)}
        type="button"
      >
        <AssignmentQueueTags compact queue={queue} />
        <span aria-hidden="true" className={styles.indicator}>
          ▾
        </span>
      </button>
      <div
        aria-hidden={!open}
        className={styles.body}
        data-open={open ? "true" : "false"}
        id={contentId}
        inert={!open}
      >
        <div className={styles.bodyInner}>
          <ol className={styles.sessions}>
            {queue.items.map((item) => {
              const scheduleMoved =
                item.plannedAvailableFrom !== item.effectiveAvailableFrom ||
                item.plannedAvailableUntil !== item.effectiveAvailableUntil;
              return (
                <li className={styles.session} key={item.id}>
                  <strong>
                    {item.sequenceNumber}회 ·{" "}
                    {vocabAssignmentQueueItemStatusLabel(item.status)}
                  </strong>
                  <span>
                    <MetaTagList>{unitRangeDisplayGroups(item.unitLabels).map((group, index) => <MetaTag key={index}>{group.label}</MetaTag>)}<MetaTag>{item.questionCount}개</MetaTag></MetaTagList>
                  </span>
                  <span>
                    {localDateTime(item.effectiveAvailableFrom)} ~{" "}
                    {localDateTime(item.effectiveAvailableUntil)}
                  </span>
                  {scheduleMoved ? (
                    <small>
                      최초 예정 {localDateTime(item.plannedAvailableFrom)}
                    </small>
                  ) : null}
                </li>
              );
            })}
          </ol>
          {queue.status === "attention" ? (
            <div aria-label="배정된 시험 처리" className={styles.actions}>
              <p role="status">{queueAttentionView(queue) ?? "현재 회차를 확인해 주세요."}</p>
              <Button
                disabled={resolving || processingDisabled}
                onClick={() => void resolve("retry")}
                size="small"
              >
                같은 회차 다시 배정
              </Button>
              <Button
                disabled={resolving || processingDisabled}
                onClick={() => void resolve("skip")}
                size="small"
                variant="quiet"
              >
                이 회차 보류
              </Button>
              <Button
                disabled={resolving || processingDisabled}
                onClick={() => void resolve("cancel")}
                size="small"
                variant="danger"
              >
                남은 시험 취소
              </Button>
            </div>
          ) : null}
        </div>
      </div>
    </article>
  );
}

export function AssignmentQueueHistory({
  processingDisabled = false,
  onResolutionPending,
  headingLevel = 2,
  onResolutionError,
  onResolved,
  queues,
}: {
  processingDisabled?: boolean;
  onResolutionPending?: (seriesId: string, pending: boolean) => void;
  headingLevel?: 2 | 3;
  onResolutionError?: (error: unknown) => void;
  onResolved?: (result: QueueResolutionResult) => void;
  queues: readonly VocabAssignmentQueueSummary[];
}) {
  if (queues.length === 0) return null;
  const Heading = headingLevel === 2 ? "h2" : "h3";
  return (
    <section aria-labelledby="vocab-assignment-queue-history-title">
      <Heading
        className={styles.title}
        id="vocab-assignment-queue-history-title"
      >
        배정된 시험
      </Heading>
      <div className={styles.list}>
        {queues.map((queue) => (
          <AssignmentQueueDisclosure
            processingDisabled={processingDisabled}
            onResolutionPending={onResolutionPending}
            key={queue.seriesId}
            onResolutionError={onResolutionError}
            onResolved={onResolved}
            queue={queue}
          />
        ))}
      </div>
    </section>
  );
}
