import fs from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import {
  findModuleBoundaryViolations,
  formatModuleBoundaryViolations,
  inspectBoundarySource,
  resolvesInside,
} from "@/test-support/module-boundary";

const featureRoot = path.resolve("src/features/assignments");
const domainRoot = path.join(featureRoot, "domain");
const apiRoot = path.join(featureRoot, "api");
const applicationRoot = path.join(featureRoot, "application");
const transportRoot = path.join(featureRoot, "transport");
const pureSharedModules = new Map([
  ["@/lib/deadline", path.resolve("src/lib/deadline.ts")],
  [
    "@/lib/admin/assignment-edit-policy",
    path.resolve("src/lib/admin/assignment-edit-policy.ts"),
  ],
  [
    "@/lib/admin/assignment-replacement-fingerprint",
    path.resolve("src/lib/admin/assignment-replacement-fingerprint.ts"),
  ],
]);

describe("assignment feature dependency boundaries", () => {
  it("keeps the domain independent from React, transport, UI, and API modules", () => {
    const violations = findModuleBoundaryViolations({
      root: domainRoot,
      allowModule: (specifier, importer) =>
        specifier === "zod" ||
        specifier === "@/lib/deadline" ||
        specifier === "@/lib/admin/assignment-edit-policy" ||
        resolvesInside(importer, specifier, [domainRoot]),
      forbidEndpointLiterals: true,
      forbidJsx: true,
      forbidBrowserGlobals: true,
    });

    expect(
      violations,
      formatModuleBoundaryViolations(violations),
    ).toStrictEqual([]);
  });

  it("keeps API adapters declarative and independent from React and network execution", () => {
    const violations = findModuleBoundaryViolations({
      root: apiRoot,
      allowModule: (specifier, importer, typeOnly) =>
        specifier === "zod" ||
        pureSharedModules.has(specifier) ||
        (typeOnly &&
          specifier.startsWith("@/lib/admin/") &&
          specifier.includes("assignment") &&
          specifier.endsWith("-request")) ||
        resolvesInside(importer, specifier, [apiRoot, domainRoot]),
      forbidJsx: true,
      forbidBrowserGlobals: true,
    });

    expect(
      violations,
      formatModuleBoundaryViolations(violations),
    ).toStrictEqual([]);
  });

  it("keeps assignment application flows independent from React, JSX, and endpoint literals", () => {
    const violations = findModuleBoundaryViolations({
      root: applicationRoot,
      allowModule: (specifier, importer) =>
        specifier === "zod" ||
        resolvesInside(importer, specifier, [
          applicationRoot,
          apiRoot,
          domainRoot,
          transportRoot,
        ]),
      forbidEndpointLiterals: true,
      forbidJsx: true,
      forbidBrowserGlobals: true,
    });

    expect(
      violations,
      formatModuleBoundaryViolations(violations),
    ).toStrictEqual([]);
  });

  it("keeps the first migrated exact-review controller free from business request details", () => {
    const source = fs.readFileSync(
      path.join(
        featureRoot,
        "controller",
        "use-direct-review-assignment-controller.ts",
      ),
      "utf8",
    );

    expect(source).not.toMatch(/["'`]\/api\//);
    expect(source).not.toContain("JSON.stringify(draft)");
    expect(source).not.toContain("openedAt");
  });

  it.each([...pureSharedModules.values()])(
    "keeps the shared pure leaf %s free from transitive runtime dependencies",
    (sharedFile) => {
      const violations = inspectBoundarySource(
        sharedFile,
        fs.readFileSync(sharedFile, "utf8"),
        {
          root: path.dirname(sharedFile),
          allowModule: () => false,
          forbidEndpointLiterals: true,
          forbidJsx: true,
          forbidBrowserGlobals: true,
        },
      );

      expect(
        violations,
        formatModuleBoundaryViolations(violations),
      ).toStrictEqual([]);
    },
  );
});
