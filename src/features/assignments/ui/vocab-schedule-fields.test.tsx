/** @vitest-environment jsdom */

import "@testing-library/jest-dom/vitest";

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { VocabAssignmentScreenController } from "../controller/use-vocab-assignment-screen";
import { VocabScheduleFields, type VocabScheduleFieldsProps } from "./vocab-schedule-fields";
import { VocabScheduleDetailFields, type VocabScheduleDetailFieldsProps } from "./vocab-schedule-detail-fields";
import { resolveVocabScheduleCounts } from "../domain/vocab-schedule";
import { assignmentQuestionModePolicy } from "../domain/assignment-question-mode-policy";
import { assignmentQuestionModeScheduleMessage } from "../presentation/assignment-question-mode-view";
import { vocabScheduleLabels, vocabScheduleSessionRows } from "../presentation/vocab-schedule-view";
import { useVocabScheduleTemplateInput } from "../client/controllers/use-vocab-schedule-template-input";
import { readFileSync } from "node:fs";
import { VocabUnitAllocationFields } from "./vocab-unit-allocation-fields";
import { vocabUnitAllocationView } from "../presentation/vocab-question-view";

function AllocationHarness({ value }: { value: VocabAssignmentScreenController }) {
  return <VocabUnitAllocationFields view={vocabUnitAllocationView({
    assignmentMode: value.planner.assignmentMode, scheduleEnabled: value.planner.scheduleEnabled,
    questionCountMode: value.planner.questionCountMode,
    defaultSessionCount: value.unitAllocation?.defaultSessionCount ?? 0,
    remainingUnitIds: value.unitAllocation?.remainingUnitIds ?? [], selectedUnits: value.selectedUnits,
  })} unitsPerSession={value.planner.unitsPerSession} overflowPolicy={value.planner.overflowPolicy}
    fieldErrors={{}} onUnitsPerSessionChange={value.actions.changeUnitsPerSession}
    onOverflowPolicyChange={value.actions.changeOverflowPolicy} />;
}


afterEach(cleanup);

function controller() {
  return {
    actions: {
      applyTemplate: vi.fn(),
      saveCurrentTemplate: vi.fn(),
      toggleWeekday: vi.fn(),
      updateSchedule: vi.fn(),
      updateSessionSchedule: vi.fn(),
      cancelExtraDates: vi.fn(),
      changeExtraDatePolicy: vi.fn(),
      changeOverflowPolicy: vi.fn(),
      changeUnitsPerSession: vi.fn(),
      changeScheduleEnabled: vi.fn(),
    },
    fieldErrors: {},
    bulk: {
      preview: null,
      state: { draft: { questionMode: "book_meaning_choice" } },
    },
    defaultSessionCount: 3,
    repeatCycleCount: 1,
    distribution: "split",
    scheduledQuestionCount: 60,
    requiresExtraDateDecision: false,
    planner: {
      assignmentMode: "word_count",
      unitsPerSession: 1,
      questionCountMode: "all",
      overflowPolicy: "leave",
      schedule: {
        availableTime: "16:00",
        deadlineDayOffset: 0,
        deadlineTime: "22:00",
        startDate: "2026-08-21",
        weekdays: [1, 3, 5],
      },
    },
    scheduleSlots: [
      {
        availableLocalDateTime: "2026-08-24T16:00",
        date: "2026-08-24",
        deadlineLocalDateTime: "2026-08-24T22:00",
        sessionNumber: 1,
      },
      {
        availableLocalDateTime: "2026-08-26T16:00",
        date: "2026-08-26",
        deadlineLocalDateTime: "2026-08-26T22:00",
        sessionNumber: 2,
      },
      {
        availableLocalDateTime: "2026-08-28T16:00",
        date: "2026-08-28",
        deadlineLocalDateTime: "2026-08-28T22:00",
        sessionNumber: 3,
      },
    ],
    selectedUnits: [
      { id: "unit-1", label: "DAY 1" },
      { id: "unit-2", label: "DAY 2" },
    ],
    templateSaving: false,
    timeTemplates: [],
    unitAllocation: null,
  } as unknown as VocabAssignmentScreenController;
}


function ScheduleHarness({ value }: { value: VocabAssignmentScreenController }) {
  const schedule = value.planner.schedule;
  const enabled = value.planner.scheduleEnabled !== false;
  const name = useVocabScheduleTemplateInput({ saving: value.templateSaving, onSave: value.actions.saveCurrentTemplate });
  const labels = vocabScheduleLabels({
    selectedDataset: value.readyDatasets?.find(book => book.id === value.planner.datasetId),
    representativeDatasetLabel: value.bulk.preview?.items?.find(item => item.datasetLabel)?.datasetLabel,
    selectedUnits: value.selectedUnits,
  });
  return <VocabScheduleFields
    schedule={schedule} scheduleEnabled={enabled}
    scheduleAllowed={assignmentQuestionModePolicy(value.bulk.state.draft.questionMode).schedule === "flexible"}
    scheduleMessage={assignmentQuestionModeScheduleMessage(value.bulk.state.draft.questionMode)}
    datasetLabel={labels.datasetLabel} rangeLabel={labels.rangeLabel}
    counts={resolveVocabScheduleCounts({
      scheduleEnabled: enabled, distribution: value.distribution, slotCount: value.scheduleSlots.length,
      defaultSessionCount: value.defaultSessionCount, extraDateDecisionSessionCount: value.extraDateDecisionSessionCount,
      requiresExtraDateDecision: value.requiresExtraDateDecision, repeatCycleCount: value.repeatCycleCount,
    })}
    onScheduleEnabledChange={value.actions.changeScheduleEnabled}
    onScheduleChange={value.actions.updateSchedule} onWeekdayToggle={value.actions.toggleWeekday}
    onCancelExtraDates={value.actions.cancelExtraDates}
    onRepeatFromStart={() => value.actions.changeExtraDatePolicy("repeat_from_start")}
    details={<VocabScheduleDetailFields
      availableTimeEnabled={schedule.availableTimeEnabled !== false}
      sessionRows={vocabScheduleSessionRows({
        slots: value.scheduleSlots, previewSessions: value.bulk.preview?.commonPlanSummary?.sessions ?? [],
        hasSelectedWeekdays: schedule.weekdays.length > 0, distribution: value.distribution,
        availableTimeEnabled: schedule.availableTimeEnabled !== false,
      })}
      timeTemplates={value.timeTemplates} templateSaving={value.templateSaving}
      templateName={name.name} onTemplateNameChange={name.setName} onSaveTemplate={name.save}
      onApplyTemplate={value.actions.applyTemplate} onSessionScheduleChange={value.actions.updateSessionSchedule}
    />}
  />;
}

describe("VocabScheduleFields", () => {
  it("두 표시 부품은 전체 제어기·요청·상태 훅을 직접 가져오지 않는다", () => {
    for (const file of ["vocab-schedule-fields.tsx", "vocab-schedule-detail-fields.tsx"]) {
      const source = readFileSync(`src/features/assignments/ui/${file}`, "utf8");
      expect(source).not.toMatch(/\bcontroller\b|ReturnType|\bfetch\s*\(|\buseState\b|\buseEffect\b|\btoast\b/);
      expect(source).not.toMatch(/from ["'][^"']*(?:controller|transport)[^"']*["']/);
    }
  });

  it("일정 값·오류·콜백만으로 독립 표시하고 오류 입력 옆에서 수정한다", () => {
    const props: VocabScheduleFieldsProps = {
      schedule: { startDate: "2026-09-07", weekdays: [1], availableTime: "16:00", deadlineTime: "22:00", deadlineDayOffset: 0 },
      scheduleEnabled: true, scheduleAllowed: true, scheduleMessage: null,
      datasetLabel: "선택 단어장", rangeLabel: "DAY 2~DAY 1",
      counts: { baseSessionCount: 2, currentScheduleCount: 1, remainingSessionCount: 1, requiresExtraDateDecision: false, repeatCycleCount: 1 },
      fieldErrors: { startDate: "배정 기준일을 확인해 주세요.", weekdays: "시험 볼 요일을 선택해 주세요." },
      onScheduleEnabledChange: vi.fn(), onScheduleChange: vi.fn(), onWeekdayToggle: vi.fn(),
      onCancelExtraDates: vi.fn(), onRepeatFromStart: vi.fn(), details: <span>일정 상세 자리</span>,
    };
    render(<VocabScheduleFields {...props} />);
    expect(screen.getByText("가능한 배정 2회 · 선택 1회 · 남음 1회")).toBeVisible();
    const date = screen.getByLabelText(/^배정 기준일/);
    expect(date).toHaveAttribute("aria-invalid", "true");
    expect(date).toHaveAttribute("aria-errormessage", "vocab-start-date-error");
    fireEvent.change(date, { target: { value: "2026-09-08" } });
    expect(props.onScheduleChange).toHaveBeenCalledExactlyOnceWith({ startDate: "2026-09-08" });
    fireEvent.click(screen.getByRole("button", { name: "화" }));
    expect(props.onWeekdayToggle).toHaveBeenCalledExactlyOnceWith(2);
    expect(screen.getByText("일정 상세 자리")).toBeVisible();
  });

  it("회차 상세는 표시 행·이름 값만 받아 원래 시간 쌍과 양식 콜백을 전달한다", () => {
    const props: VocabScheduleDetailFieldsProps = {
      availableTimeEnabled: true,
      sessionRows: [{ sessionNumber: 1, label: "1회차 [9월 7일 (월)]", editable: true, queued: false,
        availableLocalDateTime: "2026-09-07T16:00", deadlineLocalDateTime: "2026-09-07T22:00",
        generatedTimeLabel: "", deadlineError: "마감 시각을 확인해 주세요." }],
      timeTemplates: [], templateName: "저녁반", templateSaving: false,
      onSessionScheduleChange: vi.fn(), onApplyTemplate: vi.fn(),
      onTemplateNameChange: vi.fn(), onSaveTemplate: vi.fn(),
    };
    const { rerender } = render(<VocabScheduleDetailFields {...props} />);
    const deadline = screen.getByLabelText(/^마감/);
    expect(deadline).toHaveAttribute("aria-errormessage", "vocab-session-1-deadline-error");
    fireEvent.change(deadline, { target: { value: "2026-09-08T22:00" } });
    expect(props.onSessionScheduleChange).toHaveBeenCalledExactlyOnceWith(1, {
      availableLocalDateTime: "2026-09-07T16:00", deadlineLocalDateTime: "2026-09-08T22:00",
    });
    fireEvent.change(screen.getByLabelText("공개"), { target: { value: "2026-09-07T17:00" } });
    expect(props.onSessionScheduleChange).toHaveBeenNthCalledWith(2, 1, {
      availableLocalDateTime: "2026-09-07T17:00", deadlineLocalDateTime: "2026-09-07T22:00",
    });
    fireEvent.change(screen.getByLabelText("새 시간 템플릿 이름"), { target: { value: "오전반" } });
    expect(props.onTemplateNameChange).toHaveBeenCalledExactlyOnceWith("오전반");
    fireEvent.click(screen.getByRole("button", { name: "저장" }));
    expect(props.onSaveTemplate).toHaveBeenCalledOnce();
    rerender(<VocabScheduleDetailFields {...props} templateSaving />);
    expect(screen.getByRole("button", { name: "저장 중" })).toBeDisabled();
    expect(screen.getByLabelText("새 시간 템플릿 이름")).toHaveValue("저녁반");
  });

  it("월수금 선택 상태와 세 회차의 실제 날짜를 함께 표시한다", () => {
    const value = controller();
    render(<ScheduleHarness value={value} />);

    expect(screen.getByText("배정 기준일")).toBeVisible();
    expect(screen.getByRole("button", { name: "월" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    expect(screen.getByRole("button", { name: "화" })).toHaveAttribute(
      "aria-pressed",
      "false",
    );
    expect(screen.getByRole("button", { name: "수" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    expect(screen.getByRole("button", { name: "금" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    expect(screen.getByText(/1회차 \[8월 24일 \(월\)\]/)).toBeVisible();
    expect(screen.getByText(/2회차 \[8월 26일 \(수\)\]/)).toBeVisible();
    expect(screen.getByText(/3회차 \[8월 28일 \(금\)\]/)).toBeVisible();
    expect(screen.getByText("가능한 배정 3회 · 선택 3회 · 남음 0회")).toBeVisible();

    fireEvent.change(screen.getByDisplayValue("2026-08-21"), {
      target: { value: "2026-08-22" },
    });
    expect(value.actions.updateSchedule).toHaveBeenCalledWith({
      startDate: "2026-08-22",
    });

    fireEvent.click(screen.getByRole("button", { name: "수" }));
    expect(value.actions.toggleWeekday).toHaveBeenCalledWith(3);
  });

  it("이전 미리보기보다 현재 선택한 요일 수를 우선 표시한다", () => {
    const value = controller();
    value.bulk.preview = {
      commonPlanSummary: null,
      items: [{ sessions: Array.from({ length: 5 }, () => ({})) }],
    } as never;
    render(<ScheduleHarness value={value} />);

    expect(
      screen.getByText("가능한 배정 3회 · 선택 3회 · 남음 0회"),
    ).toBeVisible();
  });

  it("공개 시간은 체크로 열고 닫으며 마감일은 당일을 기본으로 표시한다", () => {
    const value = controller();
    value.planner.schedule.availableTimeEnabled = false;
    render(<ScheduleHarness value={value} />);

    expect(screen.getByLabelText("공개 시간").closest("[aria-hidden]"))
      .toHaveAttribute("aria-hidden", "true");
    expect(screen.getByDisplayValue("당일")).toBeVisible();
    const publicTimeCheckbox = screen.getAllByRole("checkbox")[1]!;
    expect(publicTimeCheckbox).not.toBeChecked();
    fireEvent.click(publicTimeCheckbox);
    expect(value.actions.updateSchedule).toHaveBeenCalledWith({
      availableTimeEnabled: true,
    });
  });

  it("기본 회차보다 날짜가 많으면 범위 반복 여부를 확인한다", () => {
    const value = controller();
    value.defaultSessionCount = 3;
    value.extraDateDecisionSessionCount = 2;
    value.repeatCycleCount = 2;
    value.requiresExtraDateDecision = true;
    render(<ScheduleHarness value={value} />);

    expect(screen.getByText(/범위를 총 2바퀴 사용합니다/)).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "범위 반복" }));
    expect(value.actions.changeExtraDatePolicy).toHaveBeenCalledWith(
      "repeat_from_start",
    );
    fireEvent.click(screen.getByRole("button", { name: "추가 취소" }));
    expect(value.actions.cancelExtraDates).toHaveBeenCalledOnce();
  });

  it("승인된 반복 일정은 현재 범위 바퀴 수를 표시한다", () => {
    const value = controller();
    value.defaultSessionCount = 2;
    value.repeatCycleCount = 2;
    value.scheduleSlots = value.scheduleSlots.slice(0, 3);

    render(<ScheduleHarness value={value} />);

    expect(screen.getByText("가능한 배정 2회 · 선택 2회 · 남음 0회 · 범위 2바퀴")).toBeVisible();
  });

  it("25단위를 회차당 5단위로 나눈 기본 5회를 일정에서 다시 25회로 세지 않는다", () => {
    const value = controller();
    value.planner.assignmentMode = "per_session";
    value.planner.unitsPerSession = 5;
    value.defaultSessionCount = 5;
    value.extraDateDecisionSessionCount = 5;
    value.repeatCycleCount = 2;
    value.requiresExtraDateDecision = true;
    value.selectedUnits = Array.from({ length: 25 }, (_, index) => ({
      id: `unit-${index + 1}`,
      label: `DAY ${String(index + 1).padStart(2, "0")}`,
    })) as never;
    value.scheduleSlots = Array.from({ length: 7 }, (_, index) => ({
      availableLocalDateTime: `2026-09-0${index + 1}T16:00`,
      date: `2026-09-0${index + 1}`,
      deadlineLocalDateTime: `2026-09-0${index + 1}T22:00`,
      sessionNumber: index + 1,
    }));

    render(<ScheduleHarness value={value} />);

    expect(screen.getByText("가능한 배정 5회 · 선택 5회 · 남음 0회")).toBeVisible();
    expect(screen.queryByText(/남음 18회/)).not.toBeInTheDocument();
    expect(screen.getByText(/범위를 총 2바퀴 사용합니다/)).toBeVisible();
  });

  it("요일을 고르기 전에는 계산용 임시 날짜를 일정처럼 표시하지 않는다", () => {
    const value = controller();
    value.planner.schedule.weekdays = [];
    value.scheduleSlots = [];
    value.bulk.preview = {
      commonPlanSummary: {
        sessions: [
          {
            sessionNumber: 1,
            availableFrom: "2026-08-21T07:00:00.000Z",
            availableUntil: "2026-08-21T13:00:00.000Z",
            questionCount: 45,
          },
          {
            sessionNumber: 2,
            availableFrom: "2026-08-28T07:00:00.000Z",
            availableUntil: "2026-08-28T13:00:00.000Z",
            questionCount: 35,
          },
        ],
      },
      items: [],
    } as never;

    render(<ScheduleHarness value={value} />);

    expect(screen.queryByText("회차별 시간")).not.toBeInTheDocument();
    expect(screen.queryByText(/배정 합계/)).not.toBeInTheDocument();
    expect(screen.getByText("날짜 없이 3회 배정")).toBeVisible();
    expect(screen.getByText("요일을 선택하지 않으면 날짜 없이 순서대로 배정합니다.")).toBeVisible();
  });

  it("미리보기가 없어도 현재 선택한 단어장을 일정 태그에 표시한다", () => {
    const value = controller();
    value.planner.datasetId = "dataset-a";
    value.readyDatasets = [{
      id: "dataset-a",
      title: "선택 단어장",
      displayName: "선택 단어장",
      edition: null,
      editionLabel: null,
      catalogGroup: "high",
      materialKind: "wordbook",
      gradeCode: "H1",
      publisher: null,
      seriesTitle: null,
      academicYear: null,
      curriculumRevision: null,
      isAssignable: true,
      catalogSortIndex: 1,
    }] as never;

    render(<ScheduleHarness value={value} />);

    expect(screen.getByText("선택 단어장")).toBeVisible();
  });

  it("회차별은 단위 수와 남은 범위 처리를 함께 표시한다", () => {
    const value = controller();
    value.planner.assignmentMode = "per_session";
    value.planner.schedule.weekdays = [1, 3];
    value.scheduleSlots = value.scheduleSlots.slice(0, 2);
    value.unitAllocation = {
      defaultSessionCount: 3,
      issue: null,
      remainingUnitIds: [],
      requiresExtraDateDecision: false,
      sessionCycleIndexes: [0, 0, 0],
      sessionUnitIds: [["unit-1"], ["unit-2"], ["unit-3"]],
    };

    render(<AllocationHarness value={value} />);

    expect(screen.getByRole("button", { name: "가능한 범위까지만" }))
      .toBeVisible();
    expect(screen.getByRole("button", { name: "같은 요일로 이어서" }))
      .toBeVisible();
    expect(screen.getByText("회차당 단위 수")).toBeVisible();
    expect(screen.queryByText("요일별 단위 수")).not.toBeInTheDocument();
  });

  it("새 배정은 공통 회차당 단위 수만 입력한다", () => {
    const value = controller();
    value.planner.assignmentMode = "per_session";
    value.planner.schedule.weekdays = [1, 3];
    value.planner.unitsPerSession = 5;

    render(<AllocationHarness value={value} />);

    expect(screen.getByRole("textbox", {
      name: /회차당 단위 수/,
    })).toHaveValue("5");
    expect(screen.queryByText("요일별 단위 수")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("월요일 단위 수")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("수요일 단위 수")).not.toBeInTheDocument();
  });

  it("시험일 없는 회차별 배정은 회차 수만 보이고 일정 전용 선택은 숨긴다", () => {
    const value = controller();
    value.planner.assignmentMode = "per_session";
    value.planner.scheduleEnabled = false;
    value.planner.unitsPerSession = 5;
    value.defaultSessionCount = 5;
    value.unitAllocation = {
      defaultSessionCount: 5,
      issue: null,
      remainingUnitIds: [],
      requiresExtraDateDecision: false,
      sessionCycleIndexes: [0, 0, 0, 0, 0],
      sessionUnitIds: Array.from({ length: 5 }, (_, index) => [
        `unit-${index + 1}`,
      ]),
    };

    render(<AllocationHarness value={value} />);

    expect(screen.getByText("회차당 단위 수")).toBeVisible();
    expect(screen.getByText("기본 5회")).toBeVisible();
    expect(screen.queryByText("남은 범위")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "같은 요일로 이어서" }))
      .not.toBeInTheDocument();
  });

  it("단어 수 직접 입력도 남은 범위를 다음 주로 잇는 선택을 제공한다", () => {
    const value = controller();
    value.planner.questionCountMode = "manual";

    render(<AllocationHarness value={value} />);

    expect(screen.getByText("남은 범위")).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "같은 요일로 이어서" }));
    expect(value.actions.changeOverflowPolicy).toHaveBeenCalledWith(
      "continue_weekly",
    );
  });

  it("가능한 범위까지만 배정하면 남은 정확한 범위를 표시한다", () => {
    const value = controller();
    value.planner.assignmentMode = "per_session";
    value.unitAllocation = {
      defaultSessionCount: 2,
      issue: null,
      remainingUnitIds: ["unit-2"],
      requiresExtraDateDecision: false,
      sessionCycleIndexes: [0],
      sessionUnitIds: [["unit-1"]],
    };

    render(<AllocationHarness value={value} />);

    expect(screen.getByText("기본 2회 · 남음 DAY 2 (1단위)")).toBeVisible();
  });

  it("선택 일정의 대기 회차와 일정 밖 남은 범위를 함께 표시한다", () => {
    const value = controller();
    value.planner.assignmentMode = "per_session";
    value.planner.schedule.weekdays = [1, 3];
    value.selectedUnits = [
      { id: "unit-1", label: "DAY 1" },
      { id: "unit-2", label: "DAY 2" },
      { id: "unit-3", label: "DAY 3" },
      { id: "unit-4", label: "DAY 4" },
      { id: "unit-5", label: "DAY 5" },
      { id: "unit-6", label: "DAY 6" },
    ] as never;
    value.unitAllocation = {
      defaultSessionCount: 3,
      issue: null,
      remainingUnitIds: ["unit-5", "unit-6"],
      requiresExtraDateDecision: false,
      sessionCycleIndexes: [0, 0],
      sessionUnitIds: [
        ["unit-1", "unit-2"],
        ["unit-3", "unit-4"],
      ],
    };

    render(<AllocationHarness value={value} />);

    expect(
      screen.getByText("기본 3회 · 남음 DAY 5~DAY 6 (2단위)"),
    ).toBeVisible();
  });

  it("두 번째 회차부터 첫 시험과 앞 마감의 실제 공개 조건을 표시한다", () => {
    const value = controller();
    render(<ScheduleHarness value={value} />);

    expect(screen.getAllByText("앞 회차 첫 시험 완료 후 공개")).toHaveLength(2);
  });
});
