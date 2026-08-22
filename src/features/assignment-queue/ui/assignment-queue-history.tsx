"use client";

import { useId, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";

import { Button } from "@/design-system/primitives/button/button";
import {
  resolveAssignmentQueue,
  type QueueResolutionAction,
} from "@/features/assignment-queue/api/queue-actions";
import { AssignmentQueueTags } from "@/features/assignment-queue/ui/assignment-queue-tags";
import {
  vocabAssignmentQueueItemStatusLabel,
  vocabAssignmentQueueStatusLabel,
  type VocabAssignmentQueueSummary,
} from "@/lib/admin/vocab-assignment-queue";
import { isoToKoreanDateTimeLocal } from "@/lib/deadline";

import styles from "./assignment-queue-history.module.css";

function localDateTime(value: string) {
  return isoToKoreanDateTimeLocal(value).replace("T", " ");
}

function AssignmentQueueDisclosure({
  onResolved,
  queue,
}: {
  onResolved?: () => void;
  queue: VocabAssignmentQueueSummary;
}) {
  const [open, setOpen] = useState(
    queue.status === "active" || queue.status === "attention",
  );
  const [resolving, setResolving] = useState(false);
  const contentId = useId();
  const router = useRouter();

  async function resolve(action: QueueResolutionAction) {
    const confirmation = {
      retry:
        "같은 회차를 새 일정으로 다시 배정할까요? 기존 시험은 이력에 남습니다.",
      skip: "현재 회차를 건너뛰고 다음 회차로 넘어갈까요?",
      cancel: "남은 이어 배정을 모두 취소할까요? 완료 내역은 남습니다.",
    }[action];
    if (!window.confirm(confirmation)) return;
    setResolving(true);
    try {
      await resolveAssignmentQueue(queue.seriesId, action);
      toast.success("이어 배정 상태를 처리했습니다.");
      onResolved?.();
      router.refresh();
    } catch (error) {
      toast.error(
        error instanceof Error
          ? error.message
          : "이어 배정 상태를 처리하지 못했습니다.",
      );
    } finally {
      setResolving(false);
    }
  }

  return (
    <article className={styles.queue}>
      <button
        aria-label={`${vocabAssignmentQueueStatusLabel(queue.status)} · ${queue.datasetLabel} · ${queue.rangeLabel} · ${queue.remainingSessionCount}회 · ${queue.remainingQuestionCount}문항 남음`}
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
                    {item.unitLabels.join(" · ")} · {item.questionCount}문항
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
            <div aria-label="이어 배정 처리" className={styles.actions}>
              <Button
                disabled={resolving}
                onClick={() => void resolve("retry")}
                size="small"
              >
                같은 회차 다시 배정
              </Button>
              <Button
                disabled={resolving}
                onClick={() => void resolve("skip")}
                size="small"
                variant="quiet"
              >
                이 회차 건너뛰기
              </Button>
              <Button
                disabled={resolving}
                onClick={() => void resolve("cancel")}
                size="small"
                variant="danger"
              >
                이어 배정 취소
              </Button>
            </div>
          ) : null}
        </div>
      </div>
    </article>
  );
}

export function AssignmentQueueHistory({
  headingLevel = 2,
  onResolved,
  queues,
}: {
  headingLevel?: 2 | 3;
  onResolved?: () => void;
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
        이어 배정
      </Heading>
      <div className={styles.list}>
        {queues.map((queue) => (
          <AssignmentQueueDisclosure
            key={queue.seriesId}
            onResolved={onResolved}
            queue={queue}
          />
        ))}
      </div>
    </section>
  );
}
