import fs from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import {
  collectBoundarySourceFiles,
  formatModuleBoundaryViolations,
  inspectBoundarySource,
  resolvesInside,
} from "@/test-support/module-boundary";
import {
  collectDirectDbWriteCalls,
  collectQueryWriteEdges,
  collectReadExportWriteViolations,
  countRouterRefreshCalls,
  hasTopLevelDirective,
  inspectSharedCacheSource,
  isReadModulePath,
} from "@/test-support/server-architecture";

const srcRoot = path.resolve("src");
const sourceFiles = collectBoundarySourceFiles(srcRoot);
const servicesRoot = path.join(srcRoot, "lib", "services");
const supabaseRoot = path.join(srcRoot, "lib", "supabase");
const databaseRoot = path.join(srcRoot, "lib", "database");
const serverRoot = path.join(srcRoot, "server");
const featureServerRoots = fs
  .readdirSync(path.join(srcRoot, "features"), { withFileTypes: true })
  .filter((entry) => entry.isDirectory())
  .map((entry) => path.join(srcRoot, "features", entry.name, "server"));

function relative(file: string) {
  return path.relative(process.cwd(), file).replaceAll("\\", "/");
}

const QUERY_WRITE_ALLOWLIST = new Map<
  string,
  { maxCalls: number; removeIn: string }
>();

const DIRECT_QUERY_WRITE_ALLOWLIST = new Map<
  string,
  { maxCalls: number; removeIn: string }
>();

const ROUTER_REFRESH_ALLOWLIST = new Map<
  string,
  { maxCalls: number; removeIn: string }
>(
  [
    ["src/components/admin-logout-button.tsx", { maxCalls: 1, removeIn: "유지" }],
    ["src/components/student-logout-button.tsx", { maxCalls: 1, removeIn: "유지" }],
    ["src/features/history/ui/editable-history-detail-dialog.tsx", { maxCalls: 1, removeIn: "충돌 복구" }],
    ["src/features/history/ui/editable-history-detail-page.tsx", { maxCalls: 1, removeIn: "충돌 복구" }],
    ["src/features/student-dashboard/ui/assignment-boundary-refresh.tsx", { maxCalls: 1, removeIn: "유지" }],
    ["src/features/student-dashboard/ui/deadline-countdown.tsx", { maxCalls: 1, removeIn: "유지" }],
  ] as const,
);

describe("server architecture debt ratchets", () => {
  it("keeps R7 feature entrypoints complete and leaf assignment fields narrow", () => {
    const registry = JSON.parse(
      fs.readFileSync(path.resolve("architecture", "기능_소유권.json"), "utf8"),
    ) as {
      currentCrossFeatureImports: Array<{ removeIn: string }>;
    };
    expect(
      registry.currentCrossFeatureImports.filter(({ removeIn }) =>
        removeIn.startsWith("R7"),
      ),
    ).toStrictEqual([]);

    for (const fileName of [
      "assignment-edit-comparison.tsx",
      "assignment-range-fields.tsx",
      "assignment-settings-fields.tsx",
      "assignment-summary-panel.tsx",
      "assignment-workspace-filters.tsx",
    ]) {
      const source = fs.readFileSync(
        path.join(srcRoot, "features", "assignments", "ui", fileName),
        "utf8",
      );
      expect(source, `${fileName} must not accept a whole controller`).not.toMatch(
        /\bcontroller\s*:/,
      );
    }
  });

  it("keeps every Client module away from direct DB and server imports", () => {
    const violations = sourceFiles.flatMap((file) => {
      const source = fs.readFileSync(file, "utf8");
      if (!hasTopLevelDirective(file, source, "use client")) return [];
      return inspectBoundarySource(file, source, {
        root: srcRoot,
        allowModule: (specifier, importer) =>
          !specifier.startsWith("@supabase/") &&
          !resolvesInside(importer, specifier, [
            servicesRoot,
            supabaseRoot,
            databaseRoot,
            serverRoot,
            ...featureServerRoots,
          ]),
        forbidNetwork: false,
      });
    });

    expect(violations, formatModuleBoundaryViolations(violations)).toStrictEqual([]);
  });

  it("allows only the exact pre-R1 query-to-write debt and never lets it grow", () => {
    const readFiles = sourceFiles.filter(isReadModulePath);
    const edges = readFiles
      .flatMap((file) =>
        collectQueryWriteEdges(file, fs.readFileSync(file, "utf8")),
      );
    const directWrites = readFiles.flatMap((file) =>
      collectDirectDbWriteCalls(file, fs.readFileSync(file, "utf8")),
    );

    for (const edge of edges) {
      const key = `${relative(edge.file)}|${edge.module}|${edge.importedName}`;
      const allowance = QUERY_WRITE_ALLOWLIST.get(key);
      expect(allowance, `새 조회→변경 연결: ${key}`).toBeDefined();
      expect(
        edge.callCount,
        `허용 호출 수 증가: ${key} (${allowance?.removeIn})`,
      ).toBeLessThanOrEqual(allowance?.maxCalls ?? 0);
    }

    const directWriteCounts = new Map<string, number>();
    for (const write of directWrites) {
      const key = `${relative(write.file)}|${write.method}|${write.operation ?? "<direct>"}`;
      const allowance = DIRECT_QUERY_WRITE_ALLOWLIST.get(key);
      expect(allowance, `새 조회→직접 변경: ${key}:${write.line}`).toBeDefined();
      directWriteCounts.set(key, (directWriteCounts.get(key) ?? 0) + 1);
    }
    for (const [key, allowance] of DIRECT_QUERY_WRITE_ALLOWLIST) {
      expect(
        directWriteCounts.get(key) ?? 0,
        `기존 직접 변경 기준 변동: ${key} (${allowance.removeIn})`,
      ).toBeLessThanOrEqual(allowance.maxCalls);
    }
  });

  it("keeps exported read functions free from hidden local writes", () => {
    const violations = sourceFiles
      .filter((file) => file.startsWith(servicesRoot))
      .flatMap((file) =>
        collectReadExportWriteViolations(file, fs.readFileSync(file, "utf8")),
      );
    expect(violations).toStrictEqual([]);
  });

  it("keeps cross-request cache files free from request identity and private data", () => {
    const violations = sourceFiles.flatMap((file) => {
      return inspectSharedCacheSource(
        file,
        fs.readFileSync(file, "utf8"),
        [],
      );
    });
    expect(violations).toStrictEqual([]);
  });

  it("allows router.refresh only at documented locations without growth", () => {
    for (const file of sourceFiles) {
      const calls = countRouterRefreshCalls(file, fs.readFileSync(file, "utf8"));
      if (calls === 0) continue;
      const fileName = relative(file);
      const allowance = ROUTER_REFRESH_ALLOWLIST.get(fileName);
      expect(allowance, `새 router.refresh 위치: ${fileName}`).toBeDefined();
      expect(
        calls,
        `허용 호출 수 증가: ${fileName} (${allowance?.removeIn})`,
      ).toBeLessThanOrEqual(allowance?.maxCalls ?? 0);
    }
  });

  it("proves the guards reject representative future violations", () => {
    const queryEdges = collectQueryWriteEdges(
      "src/features/example/server/queries/list-items.ts",
      'import { finalizeItems } from "../commands/finalize-items";\nfinalizeItems();',
    );
    const directWrites = collectDirectDbWriteCalls(
      "src/features/example/server/queries/list-items.ts",
      'client.from("items").update({ active: false });',
    );
    const hiddenLocalWrites = collectReadExportWriteViolations(
      "src/lib/services/items-service.ts",
      'async function saveItems() { client.from("items").update({ active: false }); }\nexport async function getItems() { return saveItems(); }',
    );
    const dynamicQueryEdges = collectQueryWriteEdges(
      "src/features/example/server/queries/list-more-items.ts",
      'const commands = await import("../commands/save-items");',
    );
    const sharedCacheViolations = inspectSharedCacheSource(
      "src/server/cache/shared/students.ts",
      '\"use cache\";\nimport { readPrivate } from "@/lib/services/private-student-service";\nconst serviceRole = readPrivate();\nserviceRole.from("students");',
    );
    const clientViolations = inspectBoundarySource(
      "src/features/example/ui/panel.tsx",
      '\"use client\";\nimport { read } from "@/lib/services/private";',
      {
        root: srcRoot,
        allowModule: (specifier, importer) =>
          !resolvesInside(importer, specifier, [servicesRoot]),
        forbidNetwork: false,
      },
    );

    expect(queryEdges).toHaveLength(1);
    expect(dynamicQueryEdges).toHaveLength(1);
    expect(directWrites).toHaveLength(1);
    expect(hiddenLocalWrites).toHaveLength(1);
    expect(sharedCacheViolations).toHaveLength(3);
    expect(clientViolations).toHaveLength(1);
    expect(isReadModulePath("src/features/example/server/queries/items.ts")).toBe(true);
    expect(isReadModulePath("src/lib/services/list-items-service.ts")).toBe(true);
    expect(isReadModulePath("src/lib/services/load-items-service.ts")).toBe(true);
    expect(
      countRouterRefreshCalls(
        "src/features/example/ui/panel.tsx",
        'import { useRouter as useNavigation } from "next/navigation";\nconst navigation = useNavigation();\nconst alias = navigation;\nalias.refresh();\nconst refreshPage = alias.refresh;\nrefreshPage();\nconst { refresh: reload } = useNavigation();\nreload();',
      ),
    ).toBe(3);
  });
});
