"use client";

import { isoToKoreanDateTimeLocal } from "@/lib/deadline";

import type { AssignmentDeadline } from "../domain/model";
import { AssignmentDateTimeToggleField } from "./assignment-date-time-toggle-field";

function nextDayDefault() {
  return isoToKoreanDateTimeLocal(
    new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
  );
}

export function AssignmentDeadlineFields({
  deadline,
  error,
  fieldKey = "deadline",
  id,
  memoryKey = id,
  onChange,
  scheduleRequired = false,
}: {
  deadline: AssignmentDeadline;
  error?: string;
  fieldKey?: string;
  id: string;
  memoryKey?: string;
  onChange: (deadline: AssignmentDeadline) => void;
  scheduleRequired?: boolean;
}) {
  return (
    <AssignmentDateTimeToggleField
      defaultValue={nextDayDefault}
      error={error}
      fieldKey={fieldKey}
      id={id}
      memoryKey={memoryKey}
      inputLabel="마감"
      offText="마감 없이 응시합니다."
      onChange={(value) =>
        onChange(
          value === null
            ? { mode: "none" }
            : { mode: "at", koreanLocalDateTime: value },
        )
      }
      toggleLabel="응시 마감 사용"
      toggleLocked={scheduleRequired}
      toggleLockedText="배정된 시험 일정"
      value={
        deadline.mode === "at" ? deadline.koreanLocalDateTime : null
      }
    />
  );
}
