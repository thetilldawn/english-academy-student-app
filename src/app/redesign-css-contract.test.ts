import fs from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

function readCss(relativePath: string) {
  return fs.readFileSync(path.resolve(relativePath), "utf8");
}

function moduleCssFiles(directory: string): string[] {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const entryPath = path.join(directory, entry.name);
    if (entry.isDirectory()) return moduleCssFiles(entryPath);
    return entry.name.endsWith(".module.css") ? [entryPath] : [];
  });
}

const globalsCss = readCss("src/app/globals.css");
const tokensCss = readCss("src/styles/tokens.css");
const themeCss = readCss("src/styles/theme.css");
const resetCss = readCss("src/styles/reset.css");
const moduleFiles = moduleCssFiles(path.resolve("src"));
const modulesCss = moduleFiles
  .map((file) => fs.readFileSync(file, "utf8"))
  .join("\n");
const css = [globalsCss, modulesCss].join("\n");

describe("redesign CSS contract", () => {
  it("keeps literal colors inside token blocks", () => {
    expect([globalsCss, resetCss, modulesCss].join("\n")).not.toMatch(
      /#[0-9a-f]{3,8}\b|\b(?:rgb|hsl|oklch)\(/i,
    );
    expect(tokensCss).toMatch(/--paper:\s*#[0-9a-f]{6};/i);
    expect(themeCss).toMatch(/:root\[data-theme="dark"\]/);
  });

  it("uses a compact radius scale", () => {
    const values = new Set(
      [...css.matchAll(/border-radius:\s*([^;]+);/g)].map((match) =>
        match[1].trim(),
      ),
    );
    expect(values.size).toBeLessThanOrEqual(5);
  });

  it("limits blur to navigation surfaces and the brief timeout notice", () => {
    expect(css).not.toMatch(
      /(?:linear-gradient|radial-gradient|box-shadow)\s*:/,
    );
    const blurFiles = moduleFiles
      .filter((file) =>
        /backdrop-filter\s*:/.test(fs.readFileSync(file, "utf8")),
      )
      .map((file) => path.relative(path.resolve("src"), file).replaceAll("\\", "/"))
      .sort();
    expect(blurFiles).toEqual([
      "components/shell/admin-navigation.module.css",
      "components/shell/app-shell.module.css",
      "features/quiz-player/ui/quiz-frame.module.css",
    ]);
    expect(globalsCss).not.toMatch(/backdrop-filter\s*:/);
  });

  it("uses a calm color transition without lifting buttons", () => {
    const studentDetailCss = readCss(
      "src/features/students/ui/student-detail.module.css",
    );
    expect(tokensCss).toContain("--motion-standard: 250ms ease-in-out;");
    expect(tokensCss).toContain("--motion-complex: 300ms ease-in-out;");
    expect(studentDetailCss).toContain(
      "animation: panel-in var(--motion-standard) both;",
    );
    expect(css).not.toMatch(/\b(?:120|140|240)ms\b|\b0\.25s\b/);

    const interactiveHoverBodies = [
      ...css.matchAll(/([^{}]+:hover[^{}]*)\{([^{}]*)\}/g),
    ]
      .map((match) => match[2])
      .join("\n");
    expect(interactiveHoverBodies).not.toMatch(
      /(?:transform|translate|top|right|bottom|left|width|height|margin|padding)\s*:/,
    );
  });

  it("supports an explicit dark theme and switch", () => {
    expect(themeCss).toMatch(/:root\[data-theme="dark"\]/);
    expect(
      readCss("src/components/theme-toggle.module.css"),
    ).toMatch(/\.root\s*\{/);
    expect(readCss("src/components/theme-toggle.tsx")).toContain(
      'role="switch"',
    );
  });

  it("uses the theme-aware emphasis color for every pronunciation stress", () => {
    expect(tokensCss).toContain(
      "--text-emphasis: var(--status-warning-bg);",
    );
    expect(
      themeCss.match(/--text-emphasis:\s*var\(--retry\);/g),
    ).toHaveLength(2);

    for (const relativePath of [
      "src/features/quiz-player/ui/quiz-frame.module.css",
      "src/features/quiz-player/ui/quiz-choice.module.css",
      "src/features/results/ui/student-result-view.module.css",
    ]) {
      const pronunciationCss = readCss(relativePath);
      expect(pronunciationCss).toMatch(
        /\[data-stress="secondary"\]\s*\{[^}]*color:\s*var\(--text-emphasis\);[^}]*font-weight:\s*700;/,
      );
      expect(pronunciationCss).toMatch(
        /\[data-stress="primary"\]\s*\{[^}]*color:\s*var\(--text-emphasis\);[^}]*font-weight:\s*800;/,
      );
    }
  });

  it("uses only the approved font weights", () => {
    const weights = new Set(
      [...css.matchAll(/font-weight:\s*(\d+);/g)].map((match) =>
        Number(match[1]),
      ),
    );
    expect([...weights].sort()).toEqual([400, 600, 700, 800]);
  });

  it("keeps the management UI on one Korean sans-serif hierarchy", () => {
    const rootLayout = fs.readFileSync(
      path.resolve("src/app/layout.tsx"),
      "utf8",
    );

    expect(tokensCss).toContain("--font-krs: var(--font-kr);");
    expect(
      readCss("src/features/students/ui/student-directory.module.css"),
    ).toMatch(
      /\.cardName\s*\{[\s\S]*?font-family:\s*var\(--font-kr\);/,
    );
    expect(rootLayout).not.toContain("Gowun_Batang");
    expect(rootLayout).not.toContain("--font-serif-kr");
  });

  it("loads foundation layers before application CSS", () => {
    const rootLayout = readCss("src/app/layout.tsx");
    const imports = [
      'import "@/styles/tokens.css";',
      'import "@/styles/theme.css";',
      'import "@/styles/reset.css";',
      'import "@/app/globals.css";',
    ].map((statement) => rootLayout.indexOf(statement));

    expect(imports.every((index) => index >= 0)).toBe(true);
    expect(imports).toEqual([...imports].sort((left, right) => left - right));
  });

  it("renders quiz choices as one vertical column", () => {
    const quizFrameCss = readCss(
      "src/features/quiz-player/ui/quiz-frame.module.css",
    );
    expect(quizFrameCss).toMatch(
      /\.choiceList\s*\{[\s\S]*?display:\s*grid;/,
    );
    expect(quizFrameCss).not.toMatch(
      /\.choiceList\s*\{[^}]*grid-template-columns:/,
    );
  });

  it("keeps the quiz timer readable and centers the card on the full viewport", () => {
    const frameCss = readCss(
      "src/features/quiz-player/ui/quiz-frame.module.css",
    );
    const shellCss = readCss(
      "src/features/quiz-player/ui/quiz-player.module.css",
    );
    expect(globalsCss).not.toMatch(/\.quiz-(?:shell|card|prompt)/);
    expect(frameCss).toMatch(
      /\.frame\s*\{[\s\S]*?width:\s*min\(100%,\s*620px\);/,
    );
    expect(frameCss).toMatch(
      /\.timer\s*\{[\s\S]*?flex:\s*none;[\s\S]*?white-space:\s*nowrap;/,
    );
    expect(frameCss).toMatch(
      /\.timerWarning\s*\{[\s\S]*?background:\s*var\(--no-bg\);[\s\S]*?color:\s*var\(--fail\);/,
    );
    expect(frameCss).toMatch(
      /\.progressWarning \.progressValue\s*\{[\s\S]*?background:\s*var\(--fail\);/,
    );
    expect(shellCss).toMatch(
      /\.shell\s*\{[\s\S]*?min-height:\s*100dvh;[\s\S]*?align-items:\s*start;/,
    );
    expect(shellCss).toMatch(
      /@media \(min-width: 768px\)[\s\S]*?align-items:\s*center;/,
    );
  });

  it("keeps responsive cards content-sized and student gutters visible", () => {
    const assignmentWorkspaceCss = readCss(
      "src/features/assignments/ui/assignment-workspace.module.css",
    );
    expect(
      readCss("src/features/students/ui/student-directory.module.css"),
    ).toMatch(
      /\.cardGrid\s*\{[\s\S]*?align-items:\s*start;/,
    );
    expect(assignmentWorkspaceCss).toMatch(
      /\.studentList\s*\{[\s\S]*?align-items:\s*start;/,
    );
    expect(css).toContain(
      "width: min(900px, calc(100% - 36px));",
    );
    expect(css).toContain(
      "width: min(900px, calc(100% - 24px));",
    );
  });

  it("uses one aligned student-card row contract without dividers", () => {
    const studentDirectoryCss = readCss(
      "src/features/students/ui/student-directory.module.css",
    );
    expect(studentDirectoryCss).toMatch(
      /\.infoRow\s*\{[\s\S]*?grid-template-columns:\s*76px minmax\(0, 1fr\);/,
    );
    expect(studentDirectoryCss).not.toMatch(
      /\.sourceTags\s*\{[^}]*border-top\s*:/,
    );
    expect(studentDirectoryCss).not.toMatch(
      /@media \(max-width: 580px\)\s*\{[^}]*cardTitleRow/,
    );
  });
});
