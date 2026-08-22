"use client";

import { useRef, useState } from "react";

import {
  buildVocabTimeTemplateRequest,
  parseCreatedVocabTimeTemplate,
} from "../api/vocab-time-template-adapter";
import type { ExamTiming } from "../domain/model";
import type {
  VocabScheduleDraft,
  VocabTimeTemplate,
} from "../domain/vocab-assignment-plan";
import {
  assignmentTransportError,
  browserAssignmentTransport,
  type AssignmentTransport,
} from "./assignment-transport";

export function useVocabTimeTemplates({
  initialTemplates,
  schedule,
  timing,
  transport = browserAssignmentTransport,
}: {
  initialTemplates: readonly VocabTimeTemplate[];
  schedule: VocabScheduleDraft;
  timing: ExamTiming;
  transport?: AssignmentTransport;
}) {
  const [state, setState] = useState(() => ({
    saving: false,
    templates: [...initialTemplates],
  }));
  const savingRef = useRef(false);

  async function saveCurrentTemplate(label: string) {
    const trimmed = label.trim();
    if (!trimmed || savingRef.current) {
      return { ok: false as const, message: "템플릿 이름을 확인해 주세요." };
    }
    if (
      state.templates.some(
        (template) => template.label.trim() === trimmed,
      )
    ) {
      return {
        ok: false as const,
        message: "같은 이름의 시간 버튼이 이미 있습니다.",
      };
    }
    savingRef.current = true;
    setState((current) => ({ ...current, saving: true }));
    try {
      const response = await transport({
        body: buildVocabTimeTemplateRequest({
          name: trimmed.slice(0, 30),
          availableTime: schedule.availableTime,
          deadlineDayOffset: schedule.deadlineDayOffset,
          deadlineTime: schedule.deadlineTime,
          timing,
        }),
        method: "POST",
        url: "/api/admin/vocab-time-templates",
      });
      if (!response.ok) {
        return {
          ok: false as const,
          message: assignmentTransportError(
            response.data,
            "시간 템플릿을 저장하지 못했습니다.",
          ),
        };
      }
      const template = parseCreatedVocabTimeTemplate(response.data);
      setState((current) => ({
        saving: false,
        templates: [...current.templates, template],
      }));
      return { ok: true as const, template };
    } catch {
      return {
        ok: false as const,
        message: "시간 템플릿을 저장하지 못했습니다.",
      };
    } finally {
      savingRef.current = false;
      setState((current) => ({ ...current, saving: false }));
    }
  }

  return {
    customTemplates: state.templates,
    saveCurrentTemplate,
    saving: state.saving,
    timeTemplates: state.templates,
  };
}
