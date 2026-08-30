// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import type {
  AssignmentDatasetItem,
  AssignmentUnitItem,
} from "../catalog-types";
import type { SingleAssignmentController } from "../controller/use-assignment-controller";
import { AssignmentRangeFields } from "./assignment-range-fields";

const dataset: AssignmentDatasetItem = {
  academicYear: null,
  catalogGroup: "high",
  catalogSortIndex: 1,
  curriculumRevision: null,
  displayName: "테스트 단어장",
  edition: null,
  editionLabel: null,
  gradeCode: "H1",
  id: "dataset-a",
  isActive: true,
  isAssignable: true,
  materialKind: "wordbook",
  publisher: null,
  rowCount: 60,
  seriesTitle: null,
  status: "ready",
  title: "테스트 단어장",
};

const units: AssignmentUnitItem[] = [1, 2, 3].map((number) => ({
  academicYear: null,
  agency: null,
  catalogGroup: "high",
  catalogSortIndex: number,
  datasetId: dataset.id,
  displayName: `DAY ${number}`,
  entryCount: 20,
  examMonth: null,
  id: `unit-${number}`,
  itemRange: null,
  kind: "day",
  label: `DAY ${number}`,
  number,
  sortIndex: number,
  unitType: "day",
}));

afterEach(cleanup);

function controller(exactReview = false) {
  const changeRange = vi.fn();
  return {
    changeRange,
    value: {
      actions: { changeRange },
      capacity: null,
      fieldPolicy: {
        dataset: exactReview ? "locked" : "editable",
        range: exactReview ? "locked" : "editable",
      },
      isExactReview: exactReview,
      isMixedReview: false,
      state: {
        draft: {
          range: {
            datasetId: dataset.id,
            orderedUnitIds: [units[0]!.id],
          },
        },
      },
    } as unknown as SingleAssignmentController,
  };
}

describe("수정 시험 범위", () => {
  it("범위를 하나씩 켜고 끄며 전체 선택도 같은 자료 순서를 쓴다", () => {
    const value = controller();
    render(
      <AssignmentRangeFields
        capacity={value.value.capacity}
        datasets={[dataset]}
        draft={value.value.state.draft}
        fieldPolicy={value.value.fieldPolicy}
        isExactReview={value.value.isExactReview}
        onChangeRange={value.value.actions.changeRange}
        progress={null}
        units={units}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "DAY 2" }));
    expect(value.changeRange).toHaveBeenCalledWith(dataset.id, [
      units[0]!.id,
      units[1]!.id,
    ]);

    fireEvent.click(screen.getByRole("button", { name: "전체 선택" }));
    expect(value.changeRange).toHaveBeenLastCalledWith(
      dataset.id,
      units.map((unit) => unit.id),
    );
  });

  it("오답 시험 수정에서는 같은 범위판을 읽기 전용으로 표시한다", () => {
    const value = controller(true);
    render(
      <AssignmentRangeFields
        capacity={value.value.capacity}
        datasets={[dataset]}
        draft={value.value.state.draft}
        fieldPolicy={value.value.fieldPolicy}
        isExactReview={value.value.isExactReview}
        onChangeRange={value.value.actions.changeRange}
        progress={null}
        units={units}
      />,
    );

    expect(screen.getByRole("button", { name: "DAY 1" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "전체 선택" })).toBeDisabled();
  });
});
