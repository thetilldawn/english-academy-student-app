// @vitest-environment jsdom

import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import type { VocabCollisionDecisionRecord } from "../domain/vocab-collision-decisions";
import { CollisionDecisionList } from "./collision-decision-list";

const decision: VocabCollisionDecisionRecord = {
  collisionId: "collision-1",
  availableFrom: "2026-08-17T09:00:00.000Z",
  availableUntil: "2026-08-18T13:00:00.000Z",
  studentId: "student-1",
  studentName: "김학생",
  sourceSessionNumber: 2,
  unitLabel: "DAY 03~DAY 04",
  warningMessage: "같은 날 다른 시험이 있습니다.",
  warningKind: "existing_assignment",
  decision: { collisionId: "collision-1", mode: "skip" },
};

describe("겹침 처리 결정 목록", () => {
  it("건너뛴 DAY와 자동 합쳐지지 않는다는 경고를 남기고 변경·되돌리기를 제공한다", () => {
    const onChange = vi.fn();
    const onClear = vi.fn();
    render(
      <CollisionDecisionList
        decisions={[decision]}
        distribution="split"
        onChange={onChange}
        onClear={onClear}
      />,
    );

    expect(screen.getByText(/DAY 03~DAY 04는 이번 배정에서 빠지며/)).toBeTruthy();
    expect(
      screen.getByRole("button", { name: "김학생 원래 2회 건너뜀" }).getAttribute(
        "aria-pressed",
      ),
    ).toBe("true");
    fireEvent.click(screen.getByRole("button", {
      name: "김학생 원래 2회 다음 날 이동",
    }));
    expect(onChange).toHaveBeenCalledWith("collision-1", "move");
    fireEvent.click(screen.getByRole("button", {
      name: "김학생 원래 2회 되돌리기",
    }));
    expect(onClear).toHaveBeenCalledWith("collision-1");
  });
});
