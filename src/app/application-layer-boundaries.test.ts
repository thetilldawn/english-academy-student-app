import fs from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import {
  findModuleBoundaryViolations,
  formatModuleBoundaryViolations,
  resolvesInside,
} from "@/test-support/module-boundary";

const srcRoot = path.resolve("src");
const featuresRoot = path.join(srcRoot, "features");
const servicesRoot = path.join(srcRoot, "lib", "services");
const supabaseRoot = path.join(srcRoot, "lib", "supabase");
const databaseRoot = path.join(srcRoot, "lib", "database");

function featureLayerRoots(
  layer: "api" | "controller" | "domain" | "server" | "transport" | "ui",
) {
  return fs
    .readdirSync(featuresRoot, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => path.join(featuresRoot, entry.name, layer))
    .filter((directory) => fs.existsSync(directory));
}

const uiRoots = [
  ...featureLayerRoots("ui"),
  path.join(srcRoot, "components"),
  path.join(srcRoot, "design-system"),
  path.join(srcRoot, "lib", "ui"),
].filter((directory) => fs.existsSync(directory));

const serverRoots = featureLayerRoots("server");
const transportRoots = [
  ...featureLayerRoots("api"),
  ...featureLayerRoots("transport"),
];

function expectNoViolations(
  violations: ReturnType<typeof findModuleBoundaryViolations>,
) {
  expect(
    violations,
    formatModuleBoundaryViolations(violations),
  ).toStrictEqual([]);
}

describe("application layer boundaries", () => {
  it.each(featureLayerRoots("domain"))(
    "keeps domain %s independent from React, UI, services, and transport",
    (root) => {
      const violations = findModuleBoundaryViolations({
        root,
        allowModule: (specifier, importer) =>
          specifier !== "react" &&
          !resolvesInside(importer, specifier, [
            ...uiRoots,
            servicesRoot,
            supabaseRoot,
            databaseRoot,
            ...serverRoots,
            ...transportRoots,
          ]),
        forbidEndpointLiterals: true,
        forbidJsx: true,
        forbidBrowserGlobals: true,
        forbidNetwork: true,
      });

      expectNoViolations(violations);
    },
  );

  it.each(uiRoots)(
    "keeps UI %s free from server data access and direct requests",
    (root) => {
      const violations = findModuleBoundaryViolations({
        root,
        allowModule: (specifier, importer) =>
          !specifier.startsWith("@supabase/") &&
          !resolvesInside(importer, specifier, [
            servicesRoot,
            supabaseRoot,
            databaseRoot,
            ...serverRoots,
          ]),
        forbidEndpointLiterals: true,
        forbidNetwork: true,
      });

      expectNoViolations(violations);
    },
  );

  it.each(featureLayerRoots("controller"))(
    "keeps controllers %s away from services, DB clients, and direct requests",
    (root) => {
      const violations = findModuleBoundaryViolations({
        root,
        allowModule: (specifier, importer) =>
          !specifier.startsWith("@supabase/") &&
          !resolvesInside(importer, specifier, [
            servicesRoot,
            supabaseRoot,
            databaseRoot,
            ...serverRoots,
          ]),
        forbidNetwork: true,
      });

      expectNoViolations(violations);
    },
  );

  it.each(transportRoots)(
    "keeps transport %s independent from UI, controllers, and server data access",
    (root) => {
      const violations = findModuleBoundaryViolations({
        root,
        allowModule: (specifier, importer) =>
          specifier !== "react" &&
          !specifier.startsWith("@supabase/") &&
          !resolvesInside(importer, specifier, [
            ...uiRoots,
            ...featureLayerRoots("controller"),
            servicesRoot,
            supabaseRoot,
            databaseRoot,
            ...serverRoots,
          ]),
        forbidNetwork: false,
      });

      expectNoViolations(violations);
    },
  );

  it("keeps services independent from UI and controller modules", () => {
    const forbiddenRoots = [
      ...uiRoots,
      ...featureLayerRoots("controller"),
      ...transportRoots,
    ];
    const violations = findModuleBoundaryViolations({
      root: servicesRoot,
      allowModule: (specifier, importer) =>
        !resolvesInside(importer, specifier, forbiddenRoots),
      forbidNetwork: false,
    });

    expectNoViolations(violations);
  });
});
