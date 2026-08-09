import fs from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

const css = fs.readFileSync(
  path.resolve("src/app/globals.css"),
  "utf8",
);

describe("redesign CSS contract", () => {
  it("keeps literal colors inside token blocks", () => {
    const withoutTokenBlocks = css.replace(
      /:root[^\{]*\{[\s\S]*?\}/g,
      "",
    );
    expect(withoutTokenBlocks).not.toMatch(/#[0-9a-f]{3,8}\b/i);
  });

  it("uses a compact radius scale", () => {
    const values = new Set(
      [...css.matchAll(/border-radius:\s*([^;]+);/g)].map((match) =>
        match[1].trim(),
      ),
    );
    expect(values.size).toBeLessThanOrEqual(5);
  });

  it("limits blur to the responsive navigation surfaces", () => {
    expect(css).not.toMatch(
      /(?:linear-gradient|radial-gradient|box-shadow)\s*:/,
    );
    const withoutNavigationBlur = css.replace(
      /\.admin-sidebar,\s*\.admin-topbar,\s*\.topbar,\s*\.admin-mobile-nav\s*\{[\s\S]*?\}/,
      "",
    );
    expect(withoutNavigationBlur).not.toMatch(/backdrop-filter\s*:/);
  });

  it("uses a calm color transition without lifting buttons", () => {
    expect(css).toContain("--motion-standard: 250ms ease-in-out;");
    expect(css).toContain("--motion-complex: 300ms ease-in-out;");
    expect(css).toContain(
      "animation: learning-view-forward var(--motion-complex) both;",
    );
    expect(css).not.toMatch(/\b(?:120|140|240)ms\b|\b0\.25s\b/);

    const interactiveHoverBodies = [
      ...css.matchAll(/([^{}]+:hover[^{}]*)\{([^{}]*)\}/g),
    ]
      .filter((match) =>
        /button|choice|nav-link|learning-launch|filter-chip|student-card/.test(
          match[1],
        ),
      )
      .map((match) => match[2])
      .join("\n");
    expect(interactiveHoverBodies).not.toMatch(
      /(?:transform|translate|top|right|bottom|left|width|height|margin|padding)\s*:/,
    );
  });

  it("supports an explicit dark theme and switch", () => {
    expect(css).toMatch(/:root\[data-theme="dark"\]/);
    expect(css).toMatch(/\.theme-toggle\s*\{/);
  });

  it("uses only the approved font weights", () => {
    const weights = new Set(
      [...css.matchAll(/font-weight:\s*(\d+);/g)].map((match) =>
        Number(match[1]),
      ),
    );
    expect([...weights].sort()).toEqual([400, 600, 700]);
  });

  it("keeps the management UI on one Korean sans-serif hierarchy", () => {
    const rootLayout = fs.readFileSync(
      path.resolve("src/app/layout.tsx"),
      "utf8",
    );

    expect(css).toContain("--font-krs: var(--font-kr);");
    expect(css).toMatch(
      /\.student-card-name\s*\{[\s\S]*?font-family:\s*var\(--font-kr\);/,
    );
    expect(rootLayout).not.toContain("Gowun_Batang");
    expect(rootLayout).not.toContain("--font-serif-kr");
  });

  it("renders quiz choices as one vertical column", () => {
    expect(css).toMatch(
      /\.choice-list\s*\{[\s\S]*?display:\s*flex;[\s\S]*?flex-direction:\s*column;/,
    );
  });

  it("keeps the quiz timer readable and centers the card on the full viewport", () => {
    expect(css).not.toMatch(
      /\.quiz-shell,\s*\.quiz-card\s*\{[\s\S]*?max-width:\s*620px;/,
    );
    expect(css).toMatch(
      /\.quiz-card\s*\{[\s\S]*?width:\s*min\(100%,\s*620px\);[\s\S]*?max-width:\s*620px;/,
    );
    expect(css).toMatch(
      /\.timer\s*\{[\s\S]*?flex:\s*0 0 auto;[\s\S]*?white-space:\s*nowrap;/,
    );
    expect(css).toMatch(
      /\.timer-warning\s*\{[\s\S]*?color:\s*var\(--fail\);[\s\S]*?background:\s*var\(--no-bg\);/,
    );
    expect(css).toMatch(
      /\.quiz-card:has\(\.timer-warning\) \.progress-value\s*\{[\s\S]*?background:\s*var\(--fail\);/,
    );
    expect(css).not.toMatch(
      /\.timer-warning,\s*\.quiz-card:has\(\.timer-warning\) \.progress-value/,
    );
  });

  it("keeps responsive cards content-sized and student gutters visible", () => {
    expect(css).toMatch(
      /\.student-card-grid\s*\{[\s\S]*?align-items:\s*start;/,
    );
    expect(css).toMatch(
      /\.assignment-management-list\s*\{[\s\S]*?align-items:\s*start;/,
    );
    expect(css).toContain(
      "width: min(900px, calc(100% - 36px));",
    );
    expect(css).toContain(
      "width: min(900px, calc(100% - 24px));",
    );
  });

  it("uses one aligned student-card row contract without dividers", () => {
    expect(css).toMatch(
      /\.student-card-info-row\s*\{[\s\S]*?grid-template-columns:\s*68px minmax\(0, 1fr\);/,
    );
    expect(css).not.toMatch(
      /\.student-card-source-tags\s*\{[^}]*border-top\s*:/,
    );
    expect(css).not.toMatch(
      /@media \(max-width: 580px\)\s*\{[^}]*student-card-title-row/,
    );
  });
});
