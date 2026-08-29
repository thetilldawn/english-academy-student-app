import fs from "node:fs";
import path from "node:path";
import {
  assertPathExists,
  changeTrackingFloor,
  compareExact,
  duplicateValues,
  isNextSpecialEntrypoint,
  isProductionService,
  loadRegistry,
  migrationOwnershipFloor,
  normalize,
  protectedMigrationDigest,
  relative,
  root,
  verifyDirectorySnapshots,
  walk,
} from "./feature-map/common.mjs";
import { automaticChangeBase, printChangedImpact } from "./feature-map/change-impact.mjs";
import {
  collectCrossFeatureImports,
  collectFeatureToLibBridges,
  collectFeatureViaLibToFeatureImports,
  collectLibToFeatureImports,
  verifyImportScanner,
  verifyStaticOwnedImports,
} from "./feature-map/import-graph.mjs";
import { printFeature, printOwner } from "./feature-map/owner-output.mjs";
import { exactOwnershipCollections } from "./feature-map/ownership-catalog.mjs";
import { verifyFlows } from "./feature-map/flow-verification.mjs";
import { printFlow } from "./feature-map/runtime-flow.mjs";

function verifyRegistry(registry) {
  const errors = [];
  verifyImportScanner(errors);
  verifyStaticOwnedImports(errors);
  const featureIds = registry.features.map((feature) => feature.id);
  const validOwners = new Set([...featureIds, ...registry.specialOwners]);

  if (registry.schemaVersion !== 1) errors.push("지원하지 않는 소유권 지도 버전입니다.");
  if (registry.changeTrackingFrom !== changeTrackingFloor) {
    errors.push(
      `변경 영향 기준은 ${changeTrackingFloor}으로 고정되어야 합니다: ${registry.changeTrackingFrom}`,
    );
  }
  assertPathExists(registry.guide, "중앙 안내서", errors);
  for (const entry of registry.pathStates ?? []) {
    if (!entry.status || !entry.reason) errors.push(`경로 상태 설명 누락: ${entry.path}`);
    if (entry.status !== "planned") assertPathExists(entry.path, "현재 경로 상태", errors);
  }
  for (const entry of registry.retiredPathOwners ?? []) {
    if (!validOwners.has(entry.owner)) {
      errors.push(`종료 경로의 알 수 없는 소유자: ${entry.path} -> ${entry.owner}`);
    }
    if (!entry.retiredIn || !entry.reason) {
      errors.push(`종료 경로 설명 누락: ${entry.path}`);
    }
    if (fs.existsSync(path.join(root, entry.path))) {
      errors.push(`종료 경로가 다시 존재함: ${entry.path}`);
    }
  }
  for (const filePath of duplicateValues(
    (registry.retiredPathOwners ?? []).map((entry) => entry.path),
  )) {
    errors.push(`종료 경로 중복 등록: ${filePath}`);
  }

  const actualFeatureIds = fs
    .readdirSync(path.join(root, "src", "features"), { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();
  compareExact(actualFeatureIds, featureIds, "기능 폴더", errors);
  const actualSrcDirectories = fs
    .readdirSync(path.join(root, "src"), { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => `src/${entry.name}`)
    .sort();
  compareExact(
    actualSrcDirectories,
    [
      "src/app",
      "src/components",
      "src/design-system",
      "src/features",
      "src/lib",
      ...registry.srcSharedRoots.map((entry) => entry.path),
    ].sort(),
    "src 바로 아래 디렉터리",
    errors,
  );
  verifyDirectorySnapshots(registry.srcSharedRoots, "src 공용 디렉터리", validOwners, errors);

  for (const feature of registry.features) {
    assertPathExists(feature.ownerPath, `기능 ${feature.id}`, errors);
    if (feature.localGuide) assertPathExists(feature.localGuide, `기능 ${feature.id} 안내서`, errors);
    for (const entrypoint of feature.entrypoints ?? []) {
      assertPathExists(entrypoint, `기능 ${feature.id} 진입점`, errors);
    }
  }

  const actualPages = walk(path.join(root, "src", "app"))
    .filter((filePath) => /^page\.[jt]sx?$/.test(path.basename(filePath)))
    .map(relative)
    .sort();
  const actualRoutes = walk(path.join(root, "src", "app"))
    .filter((filePath) => /^route\.[jt]s$/.test(path.basename(filePath)))
    .map(relative)
    .sort();
  const actualNextSpecialEntrypoints = [
    ...walk(path.join(root, "src", "app")).filter((filePath) =>
      isNextSpecialEntrypoint(filePath),
    ),
    ...fs
      .readdirSync(path.join(root, "src"), { withFileTypes: true })
      .filter(
        (entry) =>
          entry.isFile() &&
          /^(?:instrumentation|instrumentation-client|middleware|proxy)\.[jt]s$/.test(entry.name),
      )
      .map((entry) => path.join(root, "src", entry.name)),
    ...fs
      .readdirSync(root, { withFileTypes: true })
      .filter(
        (entry) =>
          entry.isFile() &&
          /^(?:instrumentation|instrumentation-client|middleware|proxy)\.[jt]s$/.test(entry.name),
      )
      .map((entry) => path.join(root, entry.name)),
  ]
    .map(relative)
    .sort();
  const actualNextConfigs = fs
    .readdirSync(root, { withFileTypes: true })
    .filter((entry) => entry.isFile() && /^next\.config\.(?:js|mjs|cjs|ts|mts|cts)$/.test(entry.name))
    .map((entry) => entry.name)
    .sort();
  const appEntrypointsAndGuards = new Set([
    ...actualPages,
    ...actualRoutes,
    ...actualNextSpecialEntrypoints,
    ...registry.architectureGuardOwners.map((entry) => entry.path),
  ]);
  const actualAppSupport = walk(path.join(root, "src", "app"))
    .map(relative)
    .filter((filePath) => !/(^|\/)AGENTS\.md$/.test(filePath))
    .filter((filePath) => !appEntrypointsAndGuards.has(filePath))
    .sort();
  const actualServices = walk(path.join(root, "src", "lib", "services"))
    .filter(isProductionService)
    .map(relative)
    .sort();
  const actualQuizCore = walk(path.join(root, "src", "lib", "quiz"))
    .filter(isProductionService)
    .map(relative)
    .sort();
  const actualAssignmentCore = walk(path.join(root, "src", "lib", "assignment"))
    .filter(isProductionService)
    .map(relative)
    .sort();
  const actualLibDirectories = fs
    .readdirSync(path.join(root, "src", "lib"), { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => `src/lib/${entry.name}`)
    .sort();
  const actualLibRootFiles = fs
    .readdirSync(path.join(root, "src", "lib"), { withFileTypes: true })
    .filter((entry) => entry.isFile() && /\.[cm]?[jt]sx?$/.test(entry.name))
    .map((entry) => `src/lib/${entry.name}`)
    .sort();
  const actualAdminContracts = walk(path.join(root, "src", "lib", "admin"))
    .filter(isProductionService)
    .map(relative)
    .sort();
  const actualComponents = walk(path.join(root, "src", "components"))
    .filter((filePath) => isProductionService(filePath) || filePath.endsWith(".css"))
    .map(relative)
    .sort();
  const actualDesignSystem = walk(path.join(root, "src", "design-system"))
    .filter((filePath) => isProductionService(filePath) || filePath.endsWith(".css"))
    .map(relative)
    .sort();
  const actualArchitectureGuards = [
    ...walk(path.join(root, "scripts")),
    ...walk(path.join(root, "src")),
  ]
    .map(relative)
    .filter(
      (filePath) =>
        ["scripts/check-feature-map.mjs", "scripts/verify-ui-architecture.mjs"].includes(filePath) ||
        /^scripts\/feature-map\/[^/]+\.mjs$/.test(filePath) ||
        /^src\/test-support\/(module-boundary(?:\.test)?|server-architecture)\.ts$/.test(filePath) ||
        /\/(?:architecture-boundary|application-layer-boundaries|server-architecture-ratchet|ui-architecture-ratchet)\.test\.ts$/.test(filePath),
    )
    .sort();
  const actualServerFiles = walk(path.join(root, "src", "server"))
    .filter(isProductionService)
    .map(relative)
    .sort();
  const actualFeatureServerFiles = walk(path.join(root, "src", "features"))
    .filter((filePath) => normalize(filePath).includes("/server/"))
    .filter(isProductionService)
    .map(relative)
    .sort();
  const actualOwnedMigrations = walk(path.join(root, "supabase", "migrations"))
    .filter((filePath) => path.basename(filePath) >= registry.migrationOwnershipFrom)
    .filter((filePath) => filePath.endsWith(".sql"))
    .map(relative)
    .sort();
  const protectedMigrations = walk(path.join(root, "supabase", "migrations"))
    .filter((filePath) => path.basename(filePath) < migrationOwnershipFloor)
    .filter((filePath) => filePath.endsWith(".sql"))
    .map(relative)
    .sort();

  for (const { label, entries } of exactOwnershipCollections(registry)) {
    for (const entry of entries) {
      if (!validOwners.has(entry.owner)) errors.push(`${label}의 알 수 없는 소유자: ${entry.path} -> ${entry.owner}`);
      assertPathExists(entry.path, label, errors);
    }
  }
  const exactOwnedPaths = exactOwnershipCollections(registry)
    .flatMap(({ entries }) => entries)
    .map((entry) => entry.path);
  for (const filePath of duplicateValues(exactOwnedPaths)) {
    errors.push(`서로 다른 정확 소유 목록에 중복 등록: ${filePath}`);
  }
  compareExact(actualPages, registry.pageOwners.map((entry) => entry.path), "page", errors);
  compareExact(actualRoutes, registry.routeOwners.map((entry) => entry.path), "Route Handler", errors);
  compareExact(
    actualNextSpecialEntrypoints,
    registry.nextSpecialEntrypointOwners.map((entry) => entry.path),
    "Next.js 특수 진입점",
    errors,
  );
  compareExact(
    actualNextConfigs,
    registry.nextConfigOwners.map((entry) => entry.path),
    "Next.js 루트 설정",
    errors,
  );
  compareExact(
    actualAppSupport,
    registry.appSupportOwners.map((entry) => entry.path),
    "App Router 보조 파일",
    errors,
  );
  compareExact(actualServices, registry.serviceOwners.map((entry) => entry.path), "server service", errors);
  compareExact(actualQuizCore, registry.quizCoreOwners.map((entry) => entry.path), "공유 시험 계산", errors);
  compareExact(
    actualAssignmentCore,
    registry.assignmentCoreOwners.map((entry) => entry.path),
    "공유 배정 계산",
    errors,
  );
  compareExact(
    actualLibRootFiles,
    registry.libRootOwners.map((entry) => entry.path),
    "lib 루트 공용 파일",
    errors,
  );
  compareExact(
    actualLibDirectories,
    [
      "src/lib/admin",
      "src/lib/assignment",
      "src/lib/quiz",
      "src/lib/services",
      ...registry.libInfrastructureRoots.map((entry) => entry.path),
    ].sort(),
    "lib 바로 아래 디렉터리",
    errors,
  );
  verifyDirectorySnapshots(registry.libInfrastructureRoots, "lib 기반 디렉터리", validOwners, errors);
  compareExact(actualAdminContracts, registry.adminContractOwners.map((entry) => entry.path), "관리자 계약", errors);
  compareExact(actualComponents, registry.componentOwners.map((entry) => entry.path), "기존 공용 component", errors);
  compareExact(actualDesignSystem, registry.designSystemOwners.map((entry) => entry.path), "공용 UI", errors);
  compareExact(
    actualArchitectureGuards,
    registry.architectureGuardOwners.map((entry) => entry.path),
    "구조 보호선",
    errors,
  );
  compareExact(actualServerFiles, registry.serverOwners.map((entry) => entry.path), "공통 server", errors);
  compareExact(
    actualFeatureServerFiles,
    registry.featureServerOwners.map((entry) => entry.path),
    "기능 server",
    errors,
  );

  if (registry.migrationOwnershipFrom !== migrationOwnershipFloor) {
    errors.push(
      `migration 소유권 기준점은 ${migrationOwnershipFloor}으로 고정되어야 합니다: ${registry.migrationOwnershipFrom}`,
    );
  }
  if (registry.protectedMigrationCount !== protectedMigrations.length) {
    errors.push(
      `보호 migration 수가 달라졌습니다: ${registry.protectedMigrationCount} -> ${protectedMigrations.length}`,
    );
  }
  const migrationSetDigest = protectedMigrationDigest(protectedMigrations);
  if (registry.protectedMigrationSetSha256 !== migrationSetDigest) {
    errors.push(
      `기존 migration 묶음이 변경됐습니다: ${registry.protectedMigrationSetSha256} -> ${migrationSetDigest}`,
    );
  }

  const flowIds = verifyFlows(registry, featureIds, errors);
  for (const migration of registry.migrationOwners) {
    if (!validOwners.has(migration.owner)) {
      errors.push(`migration의 알 수 없는 소유자: ${migration.path} -> ${migration.owner}`);
    }
    if (!flowIds.includes(migration.flow)) {
      errors.push(`migration의 알 수 없는 기능 흐름: ${migration.path} -> ${migration.flow}`);
    }
    assertPathExists(migration.path, "migration 소유권", errors);
  }
  compareExact(
    actualOwnedMigrations,
    registry.migrationOwners.map((entry) => entry.path),
    "기준 시각 이후 migration",
    errors,
  );

  const actualCrossImports = collectCrossFeatureImports();
  const registeredCrossImports = registry.currentCrossFeatureImports.map(({ from, to }) => ({ from, to }));
  const actualEdges = actualCrossImports.map(({ from, to }) => `${from}|${to}`);
  const registeredEdges = registeredCrossImports.map(({ from, to }) => `${from}|${to}`);
  compareExact(actualEdges, registeredEdges, "기능 간 직접 import", errors);
  for (const edge of registry.currentCrossFeatureImports) {
    assertPathExists(edge.from, "기능 간 import 출발", errors);
    assertPathExists(edge.to, "기능 간 import 대상", errors);
    if (!edge.reason || !edge.removeIn) errors.push(`기능 간 import 설명 누락: ${edge.from} -> ${edge.to}`);
  }
  const actualLibToFeatureImports = collectLibToFeatureImports();
  const registeredLibToFeatureImports = registry.currentLibToFeatureImports.map(({ from, to }) => ({ from, to }));
  compareExact(
    actualLibToFeatureImports.map(({ from, to }) => `${from}|${to}`),
    registeredLibToFeatureImports.map(({ from, to }) => `${from}|${to}`),
    "lib에서 feature로 향하는 import",
    errors,
  );
  for (const edge of registry.currentLibToFeatureImports) {
    assertPathExists(edge.from, "lib import 출발", errors);
    assertPathExists(edge.to, "lib import 대상", errors);
    if (!edge.reason || !edge.removeIn) {
      errors.push(`lib에서 feature로 향하는 import 설명 누락: ${edge.from} -> ${edge.to}`);
    }
  }
  const actualFeatureToLibBridges = collectFeatureToLibBridges(actualLibToFeatureImports);
  const registeredFeatureToLibBridges = registry.currentFeatureToLibBridges.map(({ from, to }) => ({ from, to }));
  compareExact(
    actualFeatureToLibBridges.map(({ from, to }) => `${from}|${to}`),
    registeredFeatureToLibBridges.map(({ from, to }) => `${from}|${to}`),
    "기능에서 lib 중계로 향하는 import",
    errors,
  );
  for (const edge of registry.currentFeatureToLibBridges) {
    assertPathExists(edge.from, "기능 import 출발", errors);
    assertPathExists(edge.to, "lib 중계 대상", errors);
    if (!edge.reason || !edge.removeIn) {
      errors.push(`기능에서 lib 중계로 향하는 import 설명 누락: ${edge.from} -> ${edge.to}`);
    }
  }
  const actualFeatureViaLibToFeatureImports = collectFeatureViaLibToFeatureImports();
  const registeredFeatureViaLibToFeatureImports = registry.currentFeatureViaLibToFeatureImports ?? [];
  const actualIndirectImportsByKey = new Map(
    actualFeatureViaLibToFeatureImports.map((edge) => [`${edge.from}|${edge.to}`, edge]),
  );
  compareExact(
    actualFeatureViaLibToFeatureImports.map(({ from, to }) => `${from}|${to}`),
    registeredFeatureViaLibToFeatureImports.map(({ from, to }) => `${from}|${to}`),
    "기능에서 lib을 거쳐 다른 기능으로 향하는 import",
    errors,
  );
  for (const edge of registeredFeatureViaLibToFeatureImports) {
    assertPathExists(edge.from, "간접 기능 import 출발", errors);
    assertPathExists(edge.to, "간접 기능 import 대상", errors);
    if (!Array.isArray(edge.via) || edge.via.length === 0) {
      errors.push(`간접 기능 import 중계 경로 누락: ${edge.from} -> ${edge.to}`);
    } else {
      for (const filePath of edge.via) assertPathExists(filePath, "간접 기능 import 중계", errors);
      const actualEdge = actualIndirectImportsByKey.get(`${edge.from}|${edge.to}`);
      if (actualEdge && JSON.stringify(edge.via) !== JSON.stringify(actualEdge.via)) {
        errors.push(
          `간접 기능 import 중계 경로 불일치: ${edge.from} -> ${edge.to}\n` +
            `  등록: ${edge.via.join(" -> ")}\n` +
            `  실제: ${actualEdge.via.join(" -> ")}`,
        );
      }
    }
    if (!edge.reason || !edge.removeIn) {
      errors.push(`간접 기능 import 설명 누락: ${edge.from} -> ${edge.to}`);
    }
  }

  if (errors.length > 0) {
    throw new Error(["기능 소유권 지도 검사 실패", ...errors.map((error) => `- ${error}`)].join("\n"));
  }

  return {
    features: actualFeatureIds.length,
    pages: actualPages.length,
    routes: actualRoutes.length,
    nextSpecialEntrypoints: actualNextSpecialEntrypoints.length,
    nextConfigs: actualNextConfigs.length,
    appSupport: actualAppSupport.length,
    services: actualServices.length,
    quizCore: actualQuizCore.length,
    assignmentCore: actualAssignmentCore.length,
    libRootFiles: actualLibRootFiles.length,
    libInfrastructureRoots: registry.libInfrastructureRoots.length,
    srcSharedRoots: registry.srcSharedRoots.length,
    adminContracts: actualAdminContracts.length,
    components: actualComponents.length,
    designSystem: actualDesignSystem.length,
    architectureGuards: actualArchitectureGuards.length,
    serverFiles: actualServerFiles.length,
    featureServerFiles: actualFeatureServerFiles.length,
    migrations: actualOwnedMigrations.length,
    flows: registry.crossLayerFlows.length,
    crossFeatureImports: actualCrossImports.length,
    libToFeatureImports: actualLibToFeatureImports.length,
    featureToLibBridges: actualFeatureToLibBridges.length,
    featureViaLibToFeatureImports: actualFeatureViaLibToFeatureImports.length,
  };
}

try {
  const registry = loadRegistry();
  const counts = verifyRegistry(registry);
  console.log(
    `기능 지도 정상: 기능 ${counts.features}, page ${counts.pages}, Route Handler ${counts.routes}, ` +
      `Next.js 특수 진입점 ${counts.nextSpecialEntrypoints}, Next.js 루트 설정 ${counts.nextConfigs}, ` +
      `App Router 보조 파일 ${counts.appSupport}, ` +
      `server service ${counts.services}, 공유 시험 계산 ${counts.quizCore}, 공유 배정 계산 ${counts.assignmentCore}, ` +
      `lib 루트 파일 ${counts.libRootFiles}, lib 기반 디렉터리 ${counts.libInfrastructureRoots}, ` +
      `src 공용 디렉터리 ${counts.srcSharedRoots}, ` +
      `관리자 계약 ${counts.adminContracts}, ` +
      `기존 component ${counts.components}, 공용 UI ${counts.designSystem}, 구조 보호선 ${counts.architectureGuards}, ` +
      `공통 server ${counts.serverFiles}, 기능 server ${counts.featureServerFiles}, ` +
      `관리 migration ${counts.migrations}, 상세 흐름 ${counts.flows}, 기능 간 직접 import ${counts.crossFeatureImports}, ` +
      `lib→기능 import ${counts.libToFeatureImports}, 기능→lib 중계 ${counts.featureToLibBridges}, ` +
      `기능→lib→기능 간접 import ${counts.featureViaLibToFeatureImports}`,
  );

  const args = process.argv.slice(2);
  const featureFlag = args.indexOf("--feature");
  if (featureFlag >= 0) {
    const featureId = args[featureFlag + 1];
    if (!featureId) throw new Error("--feature 뒤에 기능 ID가 필요합니다.");
    if (!printFeature(registry, featureId)) {
      const available = registry.features.map(({ id }) => id).join(", ");
      throw new Error(
        `기능 ID를 찾을 수 없습니다: ${featureId}\n사용 가능: ${available}\n` +
          "실행 흐름 ID는 npm run map:flow -- <실행 흐름 ID>로 확인하세요.",
      );
    }
  }
  const ownerFlag = args.indexOf("--owner");
  if (ownerFlag >= 0) {
    const ownerId = args[ownerFlag + 1];
    if (!ownerId) throw new Error("--owner 뒤에 소유 범주 ID가 필요합니다.");
    if (!printOwner(registry, ownerId)) {
      const available = [...registry.features.map(({ id }) => id), ...registry.specialOwners].join(", ");
      throw new Error(`소유 범주를 찾을 수 없습니다: ${ownerId}\n사용 가능: ${available}`);
    }
  }
  const flowFlag = args.indexOf("--flow");
  if (flowFlag >= 0) {
    const flowId = args[flowFlag + 1];
    if (!flowId) throw new Error("--flow 뒤에 기능 흐름 ID가 필요합니다.");
    printFlow(registry, flowId);
  }
  if (args.includes("--changed")) {
    const baseFlag = args.lastIndexOf("--base");
    const suppliedBase = baseFlag >= 0 ? args[baseFlag + 1] : null;
    if (baseFlag >= 0 && !suppliedBase) throw new Error("--base 뒤에 git ref 또는 auto가 필요합니다.");
    const baseRef = suppliedBase === "auto" ? automaticChangeBase() : suppliedBase;
    printChangedImpact(registry, baseRef);
  }
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
}
