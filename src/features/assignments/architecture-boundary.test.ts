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
const contractsRoot = path.join(featureRoot, "contracts");
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
  [
    "@/lib/admin/vocab-unit-allocation",
    path.resolve("src/lib/admin/vocab-unit-allocation.ts"),
  ],
]);
const migratedControllerFiles = [
  "use-assignment-controller.ts",
  "use-assignment-preview.ts",
  "use-bulk-assignment-controller.ts",
  "use-direct-review-assignment-controller.ts",
  "use-debounced-assignment-preview.ts",
  "use-assignment-controller-runtime.ts",
  "single-assignment-controller-actions.ts",
] as const;
const forbiddenControllerModuleTargets = [
  path.join(apiRoot, "request-adapters"),
  path.join(applicationRoot, "execute-assignment-request"),
  path.join(domainRoot, "fingerprint"),
  path.join(domainRoot, "validation"),
];
const controllerRequestDetailPattern = new RegExp(
  String.raw`\b(?:build(?:Assignment|BulkAssignment|DirectReview|SingleAssignment)\w*|parse(?:Assignment|BulkAssignment|DirectReview|LegacyReview)\w*|validate(?:Assignment|Bulk|DirectReview|Single)\w*|assertValid(?:Assignment|Bulk|DirectReview|Single)\w*|assignmentRequestFingerprint|assignmentCapacityFingerprint|bulkPreviewFingerprint|bulkSubmissionFingerprint|directReviewPreviewFingerprint|directReviewSubmissionFingerprint|replacementDraftFingerprint|replacementSubmissionFingerprint|reserveIdempotencyKey|executeAssignmentRequest)\b`,
);

describe("assignment feature dependency boundaries", () => {
  it("recognizes concrete request details and aliased forbidden imports", () => {
    expect(
      [
        "buildBulkAssignmentPreviewRequest",
        "parseDirectReviewPreviewResponse",
        "validateSingleAssignmentSubmission",
      ].every((symbol) => controllerRequestDetailPattern.test(symbol)),
    ).toBe(true);
    expect(
      resolvesInside(
        path.join(featureRoot, "controller", "example.ts"),
        "@/features/assignments/api/request-adapters",
        forbiddenControllerModuleTargets,
      ),
    ).toBe(true);
  });

  it("keeps the domain independent from React, transport, UI, and API modules", () => {
    const violations = findModuleBoundaryViolations({
      root: domainRoot,
      allowModule: (specifier, importer) =>
        specifier === "zod" ||
        specifier === "@/lib/deadline" ||
        specifier === "@/lib/quiz/question-content-mode" ||
        specifier === "@/lib/admin/assignment-edit-policy" ||
        specifier === "@/lib/admin/vocab-unit-allocation" ||
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
        resolvesInside(importer, specifier, [apiRoot, contractsRoot, domainRoot]),
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
          contractsRoot,
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

  it.each(migratedControllerFiles)(
    "keeps migrated controller module %s free from request construction and business validation",
    (fileName) => {
      const file = path.join(featureRoot, "controller", fileName);
      const source = fs.readFileSync(file, "utf8");
      const violations = inspectBoundarySource(file, source, {
        root: path.dirname(file),
        allowModule: (specifier, importer) =>
          !resolvesInside(
            importer,
            specifier,
            forbiddenControllerModuleTargets,
          ),
        forbidEndpointLiterals: true,
        forbidNetwork: true,
      });

      expect(
        violations,
        formatModuleBoundaryViolations(violations),
      ).toStrictEqual([]);
      expect(source).not.toContain("JSON.stringify");
      expect(source).not.toMatch(controllerRequestDetailPattern);
      if (
        ![
          "use-assignment-controller.ts",
          "use-direct-review-assignment-controller.ts",
          "use-debounced-assignment-preview.ts",
        ].includes(fileName)
      ) {
        expect(source).not.toContain("AbortController");
      }
    },
  );

  it("keeps controller helpers narrow instead of becoming alternate application layers", () => {
    const allowedModules = new Map<string, ReadonlySet<string>>([
      [
        "single-assignment-controller-actions.ts",
        new Set([
          "react",
          "../api/response-adapters",
          "../domain/editor-state",
          "../domain/model",
          "../domain/single-draft",
        ]),
      ],
      [
        "use-assignment-controller-runtime.ts",
        new Set(["react", "../application/submission-flow"]),
      ],
      [
        "use-assignment-preview.ts",
        new Set([
          "react",
          "../api/response-adapters",
          "../application/assignment-edit-flow-adapter",
          "../application/assignment-operation-error",
          "../application/request-lifecycle",
          "../domain/editor-state",
          "../domain/model",
          "../transport/assignment-transport",
          "./use-debounced-assignment-preview",
        ]),
      ],
      [
        "use-debounced-assignment-preview.ts",
        new Set([
          "react",
          "../application/assignment-operation-error",
          "../application/preview-flow",
          "../application/request-lifecycle",
          "../transport/assignment-transport",
        ]),
      ],
    ]);

    for (const [fileName, allowed] of allowedModules) {
      const file = path.join(featureRoot, "controller", fileName);
      const violations = inspectBoundarySource(
        file,
        fs.readFileSync(file, "utf8"),
        {
          root: path.dirname(file),
          allowModule: (specifier) => allowed.has(specifier),
          forbidEndpointLiterals: true,
          forbidNetwork: true,
        },
      );
      expect(
        violations,
        `${fileName}\n${formatModuleBoundaryViolations(violations)}`,
      ).toStrictEqual([]);
    }
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
    expect(source).not.toContain("buildDirectReviewSummariesRequest");
    expect(source).not.toContain("executeAssignmentRequest");
    expect(source).not.toContain("validateDirectReviewAssignmentSubmission");
  });

  it("keeps the shared one-or-many range controller free from request lifecycle details", () => {
    const source = fs.readFileSync(
      path.join(
        featureRoot,
        "controller",
        "use-bulk-assignment-controller.ts",
      ),
      "utf8",
    );

    expect(source).not.toMatch(/["'`]\/api\//);
    expect(source).not.toContain("AbortController");
    expect(source).not.toContain("reserveIdempotencyKey");
    expect(source).not.toContain("assignmentTransportError");
    expect(source).not.toMatch(/buildBulkAssignment(?:Preview)?Request/);
    expect(source).not.toMatch(/parseBulkAssignment/);
    expect(source).not.toMatch(/validateBulk(?:Preview|Assignment)/);
  });

  it("keeps the edit controller free from request builders, parsers, and business validators", () => {
    const source = fs.readFileSync(
      path.join(
        featureRoot,
        "controller",
        "use-assignment-controller.ts",
      ),
      "utf8",
    );

    expect(source).not.toMatch(/["'`]\/api\//);
    expect(source).not.toContain("reserveIdempotencyKey");
    expect(source).not.toContain("assignmentRequestFingerprint");
    expect(source).not.toContain("assignmentTransportError");
    expect(source).not.toMatch(/build(?:Single|AssignmentEdit)/);
    expect(source).not.toMatch(/parseAssignment/);
    expect(source).not.toContain("validateSingleAssignmentSubmission");
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
