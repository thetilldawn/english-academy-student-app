// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";

import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  CountBadge,
  MetaTag,
  StatusBadge,
} from "./badge/badge";
import { Button, ButtonSpinner, IconButton } from "./button/button";
import {
  Checkbox,
  Field,
  FieldHelp,
  FieldLabel,
  Input,
  Select,
} from "./form/field";
import { SegmentedControl } from "./form/segmented-control";

afterEach(cleanup);

describe("design-system primitive contracts", () => {
  it("keeps button semantics for disabled and pending states", () => {
    render(
      <>
        <Button aria-busy disabled variant="primary">
          <ButtonSpinner />
          배정 중
        </Button>
        <IconButton aria-label="학생 추가">+</IconButton>
      </>,
    );

    expect(screen.getByRole("button", { name: "배정 중" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "배정 중" })).toHaveAttribute(
      "aria-busy",
      "true",
    );
    expect(screen.getByRole("button", { name: "학생 추가" })).toHaveAttribute(
      "type",
      "button",
    );
  });

  it("composes labelled fields and preserves native form behavior", async () => {
    const user = userEvent.setup();
    const onChecked = vi.fn();

    render(
      <>
        <Field>
          <FieldLabel htmlFor="student-name">학생 이름</FieldLabel>
          <Input
            aria-describedby="student-name-help"
            id="student-name"
            required
          />
          <FieldHelp id="student-name-help">80자 이내</FieldHelp>
        </Field>
        <Field as="label">
          <FieldLabel as="span">학년</FieldLabel>
          <Select defaultValue="3">
            <option value="3">고3</option>
          </Select>
        </Field>
        <label>
          <Checkbox onChange={(event) => onChecked(event.target.checked)} />
          선택
        </label>
      </>,
    );

    const input = screen.getByRole("textbox", { name: "학생 이름" });
    expect(input).toBeRequired();
    expect(input).toHaveAccessibleDescription("80자 이내");
    expect(screen.getByRole("combobox", { name: "학년" })).toHaveValue("3");

    await user.click(screen.getByRole("checkbox", { name: "선택" }));
    expect(onChecked).toHaveBeenCalledWith(true);
  });

  it("updates a segmented control without losing pressed state", async () => {
    const user = userEvent.setup();

    function Harness() {
      const [value, setValue] = useState<"total" | "per_question">("total");
      return (
        <>
          <span id="timing-label">시간 제한</span>
          <SegmentedControl
            ariaLabelledBy="timing-label"
            onChange={setValue}
            options={[
              { label: "전체", value: "total" },
              { label: "문제당", value: "per_question" },
            ]}
            value={value}
          />
        </>
      );
    }

    render(<Harness />);
    const perQuestion = screen.getByRole("button", { name: "문제당" });
    expect(perQuestion).toHaveAttribute("aria-pressed", "false");
    await user.click(perQuestion);
    expect(perQuestion).toHaveAttribute("aria-pressed", "true");
  });

  it("keeps status, count, and metadata meanings separate", () => {
    render(
      <>
        <StatusBadge tone="danger">미통과</StatusBadge>
        <CountBadge>2건</CountBadge>
        <MetaTag overflow="truncate" size="large">
          아주 긴 단어장 이름
        </MetaTag>
      </>,
    );

    expect(screen.getByText("미통과")).toHaveAttribute("data-tone", "danger");
    expect(screen.getByText("2건")).toHaveAttribute("data-tone", "neutral");
    expect(screen.getByText("아주 긴 단어장 이름")).not.toHaveAttribute(
      "data-tone",
      "danger",
    );
  });
});
