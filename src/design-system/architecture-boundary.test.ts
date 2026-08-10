import { readFileSync, readdirSync } from "node:fs";
import { extname, join, relative } from "node:path";

import { describe, expect, it } from "vitest";

const designSystemRoot = join(process.cwd(), "src", "design-system");

function sourceFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) return sourceFiles(path);
    return [".ts", ".tsx"].includes(extname(path)) &&
      !entry.name.endsWith(".test.ts") &&
      !entry.name.endsWith(".test.tsx")
      ? [path]
      : [];
  });
}

describe("design-system architecture boundary", () => {
  it("does not depend on application, feature, content, or service modules", () => {
    const violations = sourceFiles(designSystemRoot).flatMap((file) => {
      const source = readFileSync(file, "utf8");
      const imports = Array.from(
        source.matchAll(/from\s+["']([^"']+)["']/g),
        (match) => match[1] ?? "",
      );
      return imports
        .filter((specifier) => specifier.startsWith("@/"))
        .map(
          (specifier) =>
            `${relative(process.cwd(), file)} imports ${specifier}`,
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
