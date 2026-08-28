"use client";

import { isoToKoreanDateTimeLocal } from "@/lib/deadline";

import type { AssignmentAvailability } from "../domain/model";
import { AssignmentDateTimeToggleField } from "./assignment-date-time-toggle-field";

function defaultAvailability() {
  return isoToKoreanDateTimeLocal(new Date().toISOString());
}

export function AssignmentAvailabilityFields({
  availability,
  error,
  id,
  memoryKey,
  onChange,
  scheduleRequired = false,
}: {
  availability: AssignmentAvailability;
  error?: string;
  id: string;
  memoryKey: string;
  onChange: (availability: AssignmentAvailability) => void;
  scheduleRequired?: boolean;
}) {
  return (
    <AssignmentDateTimeToggleField
      defaultValue={defaultAvailability}
      error={error}
      fieldKey="availability"
      id={id}
      memoryKey={memoryKey}
      inputLabel="공개"
      offText="바로 공개합니다."
      onChange={(value) =>
        onChange(
          value === null
            ? { mode: "immediate" }
            : { mode: "at", koreanLocalDateTime: value },
        )
      }
      toggleLabel="공개 시간 사용"
      toggleLocked={scheduleRequired}
      toggleLockedText="이어 배정 시험 일정"
      value={
        availability.mode === "at"
          ? availability.koreanLocalDateTime
          : null
      }
    />
  );
}
