/** @vitest-environment jsdom */

import "@testing-library/jest-dom/vitest";

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { DetailHeader } from "./detail-header";

afterEach(cleanup);

describe("DetailHeader", () => {
  it("defaults to a section heading below the page breadcrumb", () => {
    render(<DetailHeader title="학생 이름" titleId="detail-title" />);

    expect(screen.getByRole("heading", { level: 2, name: "학생 이름" }))
      .toBeVisible();
  });

  it("allows a standalone page to opt into h1", () => {
    render(
      <DetailHeader headingLevel={1} title="독립 화면" titleId="page-title" />,
    );

    expect(screen.getByRole("heading", { level: 1, name: "독립 화면" }))
      .toBeVisible();
  });
});
