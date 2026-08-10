import path from "node:path";

import { describe, expect, it } from "vitest";

import { inspectBoundarySource } from "./module-boundary";

const root = path.resolve("src/features/assignments/domain");
const file = path.join(root, "nested", "probe.tsx");
const strictPolicy = {
  root,
  allowModule: (specifier: string) => specifier === "zod",
  forbidEndpointLiterals: true,
  forbidJsx: true,
  forbidBrowserGlobals: true,
} as const;

describe("module boundary inspector", () => {
  it("detects static, side-effect, dynamic, type, require, and re-export imports", () => {
    const source = [
      'import React from "react";',
      'import "./styles.module.css";',
      'type Toast = typeof import("sonner");',
      'const route = import("next/navigation");',
      'const commonJs = require("@/components/Button");',
      'const moduleRequire = module.require("react-dom");',
      'const resolved = require.resolve("next/router");',
      'export * from "../api/request-adapters";',
    ].join("\n");
    const violations = inspectBoundarySource(file, source, strictPolicy);

    expect(
      violations.filter((violation) => violation.kind === "forbidden-module"),
    ).toHaveLength(8);
  });

  it("rejects non-static module loaders", () => {
    const source = [
      "const moduleName = 'react';",
      "import(moduleName);",
      "require(moduleName);",
      "module.require(moduleName);",
      "require.resolve(moduleName);",
    ].join("\n");
    const violations = inspectBoundarySource(file, source, strictPolicy);

    expect(
      violations.filter((violation) => violation.kind === "non-static-module"),
    ).toHaveLength(4);
  });

  it("detects JSX, endpoints, browser globals, and direct or aliased fetch references", () => {
    const source = [
      'const endpoint = "/api/admin/assignments";',
      "const templatedEndpoint = `/api/admin/${studentId}`;",
      "const request = fetch;",
      'globalThis["fetch"](endpoint);',
      "const globalRequest = globalThis.fetch;",
      'const indexedRequest = globalThis["fetch"];',
      "const clientRequest = client.fetch;",
      "const browserBag = { window };",
      "const transport = { fetch };",
      "window.location.href;",
      "const view = <button>Save</button>;",
    ].join("\n");
    const violations = inspectBoundarySource(file, source, strictPolicy);
    const kinds = new Set(violations.map((violation) => violation.kind));

    expect(kinds).toEqual(
      new Set([
        "browser-global",
        "endpoint-literal",
        "jsx",
        "network",
        "tsx-file",
      ]),
    );
  });

  it("distinguishes inline type-only imports and exports from mixed runtime bindings", () => {
    const typeOnlyPolicy = {
      ...strictPolicy,
      allowModule: (specifier: string, _importer: string, typeOnly: boolean) =>
        specifier === "@/lib/validation" && typeOnly,
    };
    const typeOnlySource = [
      'import { type AssignmentInput } from "@/lib/validation";',
      'export { type AssignmentReplacementInput } from "@/lib/validation";',
    ].join("\n");
    const mixedSource =
      'import { type AssignmentInput, assignmentSchema } from "@/lib/validation";';

    expect(
      inspectBoundarySource(
        path.join(root, "type-only.ts"),
        typeOnlySource,
        typeOnlyPolicy,
      ),
    ).toStrictEqual([]);
    expect(
      inspectBoundarySource(
        path.join(root, "mixed-import.ts"),
        mixedSource,
        typeOnlyPolicy,
      ).filter((violation) => violation.kind === "forbidden-module"),
    ).toHaveLength(1);
  });

  it("allows domain fields and types that happen to use browser-like names", () => {
    const source = [
      'type Policy = { fetch: "eager"; document: string };',
      "interface RecordShape { window: string; navigator: string }",
      "const value: Policy = { fetch: 'eager', document: 'lesson' };",
    ].join("\n");

    expect(
      inspectBoundarySource(
        path.join(root, "probe.ts"),
        source,
        strictPolicy,
      ),
    ).toStrictEqual([]);
  });

  it("does not treat comments or ordinary strings as executable imports or fetch calls", () => {
    const source = [
      '// import React from "react";',
      '// fetch("/api/admin/assignments");',
      'const explanation = "fetch is performed by the controller";',
    ].join("\n");
    const violations = inspectBoundarySource(
      path.join(root, "probe.ts"),
      source,
      { ...strictPolicy, forbidEndpointLiterals: false },
    );

    expect(violations).toStrictEqual([]);
  });
});
