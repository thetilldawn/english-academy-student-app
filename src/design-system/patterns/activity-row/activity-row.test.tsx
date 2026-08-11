// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";

import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import { ActivityRow, NavigableRow, SelectableRow } from "./activity-row";

afterEach(cleanup);

describe("activity row patterns", () => {
  it("does not render empty score or timeline slots", () => {
    const { container } = render(<ActivityRow main="시험 이름" />);

    expect(screen.getByText("시험 이름")).toBeInTheDocument();
    expect(container.querySelectorAll("span")).toHaveLength(2);
    expect(container.firstElementChild).toHaveAttribute("data-has-score", "false");
    expect(container.firstElementChild).toHaveAttribute(
      "data-has-timeline",
      "false",
    );
  });

  it("marks a timeline-only row so the layout does not reserve a score column", () => {
    const { container } = render(
      <ActivityRow main="미응시 시험" timeline="마감 · 미응시" />,
    );

    expect(container.firstElementChild).toHaveAttribute("data-has-score", "false");
    expect(container.firstElementChild).toHaveAttribute(
      "data-has-timeline",
      "true",
    );
  });

  it("renders a semantic navigable row with its visual state", () => {
    render(
      <NavigableRow
        ariaLabel="테스트 학생 시험 상세"
        href="/admin/results/attempt.1"
        tone="danger"
      >
        시험 상세
      </NavigableRow>,
    );

    expect(screen.getByRole("link", { name: "테스트 학생 시험 상세" })).toHaveAttribute(
      "href",
      "/admin/results/attempt.1",
    );
    expect(screen.getByRole("link", { name: "테스트 학생 시험 상세" })).toHaveAttribute(
      "data-tone",
      "danger",
    );
  });

  it("keeps row selection separate from row actions", async () => {
    const user = userEvent.setup();
    const onToggle = vi.fn();

    render(
      <SelectableRow
        actions={<a href="/admin/results/attempt.1" onClick={(event) => event.preventDefault()}>보기</a>}
        checked={false}
        checkboxId="student-1"
        onToggle={onToggle}
        selectionAriaLabel="테스트 학생 선택"
      >
        테스트 학생
      </SelectableRow>,
    );

    const [checkbox, content] = screen.getAllByLabelText("테스트 학생 선택");
    await user.click(checkbox);
    await user.click(content);
    content.focus();
    await user.keyboard("{Enter}");
    await user.keyboard(" ");
    expect(onToggle).toHaveBeenCalledTimes(4);

    await user.click(screen.getByRole("link", { name: "보기" }));
    expect(onToggle).toHaveBeenCalledTimes(4);
  });

  it("disables both selection controls together", async () => {
    const user = userEvent.setup();
    const onToggle = vi.fn();

    render(
      <SelectableRow
        checked={false}
        checkboxId="student-2"
        disabled
        onToggle={onToggle}
        selectionAriaLabel="배정 불가 학생 선택"
      >
        배정 불가 학생
      </SelectableRow>,
    );

    const controls = screen.getAllByLabelText("배정 불가 학생 선택");
    expect(controls).toHaveLength(2);
    for (const control of controls) expect(control).toBeDisabled();
    await user.click(controls[0]);
    await user.click(controls[1]);
    expect(onToggle).not.toHaveBeenCalled();
  });
});
