// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";

import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { PronunciationText } from "./pronunciation-text";

describe("PronunciationText", () => {
  afterEach(cleanup);

  it("emphasizes only the vowel nuclei in forehead", () => {
    const { container } = render(
      <PronunciationText
        pronunciation={{
          displayKo: "포어헤드",
          segments: [
            { text: "포", stress: "primary" },
            { text: "어", stress: "none" },
            { text: "헤", stress: "secondary" },
            { text: "드", stress: "none" },
          ],
          variantId: "test:forehead",
          audioUrl: null,
          available: false,
        }}
      />,
    );

    expect(container.querySelector("[data-pronunciation-text]")).toHaveTextContent(
      "[포어헤드]",
    );
    expect(container.querySelector('[data-stress="primary"]')).toHaveTextContent(
      "포",
    );
    expect(container.querySelector('[data-stress="secondary"]')).toHaveTextContent(
      "헤",
    );
    expect(
      Array.from(container.querySelectorAll('[data-stress="none"]')).map(
        (element) => element.textContent,
      ),
    ).toEqual(["어", "드"]);
  });
});
