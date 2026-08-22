// @vitest-environment jsdom

import { describe, expect, it } from "vitest";

import { resolveInvalidAssignmentFieldFocusTarget } from "./focus-invalid-assignment-field";

describe("resolveInvalidAssignmentFieldFocusTarget", () => {
  it("미리보기 오류는 내부 도움말이 아니라 설명이 연결된 구역에 초점을 둔다", () => {
    const section = document.createElement("section");
    section.tabIndex = -1;
    section.setAttribute("aria-describedby", "preview-error");
    section.innerHTML = '<button type="button">도움말</button>';

    expect(resolveInvalidAssignmentFieldFocusTarget(section)).toBe(section);
  });

  it("명시적 초점 구역이 아니면 첫 입력을 찾는다", () => {
    const wrapper = document.createElement("div");
    wrapper.innerHTML = '<input aria-label="문항 수" />';

    expect(resolveInvalidAssignmentFieldFocusTarget(wrapper)).toBe(
      wrapper.querySelector("input"),
    );
  });
});
