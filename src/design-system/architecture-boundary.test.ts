import { readFileSync, readdirSync } from "node:fs";
import { join, relative } from "node:path";

import { describe, expect, it } from "vitest";

import {
  collectBoundarySourceFiles,
  inspectBoundarySource,
  resolvesInside,
} from "@/test-support/module-boundary";

const designSystemRoot = join(process.cwd(), "src", "design-system");

describe("design-system architecture boundary", () => {
  it("does not depend on application, feature, content, or service modules", () => {
    const violations = collectBoundarySourceFiles(designSystemRoot).flatMap((file) => {
      const source = readFileSync(file, "utf8");
      return inspectBoundarySource(file, source, {
        root: designSystemRoot,
        allowModule: (specifier, importer) =>
          !specifier.startsWith("@/") && !specifier.startsWith(".")
            ? true
            : resolvesInside(importer, specifier, [designSystemRoot]),
        forbidBrowserGlobals: false,
        forbidNetwork: false,
      }).map(
        (violation) =>
          `${relative(process.cwd(), file)}:${violation.line}:${violation.column} ${violation.detail}`,
      );
    });

    expect(violations).toEqual([]);
  });

  it("keeps primitive styles local and token-driven", () => {
    const violations = readdirSync(
      join(designSystemRoot, "primitives"),
      { recursive: true, withFileTypes: true },
    ).flatMap((entry) => {
      if (!entry.isFile() || !entry.name.endsWith(".module.css")) return [];
      const file = join(entry.parentPath, entry.name);
      const source = readFileSync(file, "utf8");
      const messages: string[] = [];
      if (source.includes(":global")) messages.push("contains :global");
      if (/#[0-9a-f]{3,8}\b/i.test(source)) messages.push("contains literal hex");
      if (/globals\.css/.test(source)) messages.push("imports globals.css");
      return messages.map(
        (message) => `${relative(process.cwd(), file)} ${message}`,
      );
    });

    expect(violations).toEqual([]);
  });
});
