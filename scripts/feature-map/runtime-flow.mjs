import fs from "node:fs";
import path from "node:path";

import {
  isProductionService,
  requiredFlowSections,
  root,
} from "./common.mjs";
import { extractImportSpecifiers, resolveImport } from "./import-graph.mjs";

export function verifyFlowDependencyCycles(flows, errors) {
  const dependencies = new Map(flows.map((flow) => [flow.id, flow.dependsOnFlows ?? []]));
  const visited = new Set();
  const visiting = new Set();
  const stack = [];

  function visit(flowId) {
    if (visited.has(flowId)) return;
    if (visiting.has(flowId)) {
      const cycleStart = stack.indexOf(flowId);
      errors.push(
        `기능 흐름 선행 관계 순환: ${[...stack.slice(cycleStart), flowId].join(" -> ")}`,
      );
      return;
    }
    visiting.add(flowId);
    stack.push(flowId);
    for (const dependencyId of dependencies.get(flowId) ?? []) {
      if (dependencies.has(dependencyId)) visit(dependencyId);
    }
    stack.pop();
    visiting.delete(flowId);
    visited.add(flowId);
  }

  for (const flowId of dependencies.keys()) visit(flowId);
}

export function inferredSiblingTests(flow, effectivePaths = null) {
  const tests = new Set();
  const sourcePaths = effectivePaths ?? new Set(
    Object.entries(flow.touchpoints)
      .filter(([section]) => section !== "tests")
      .flatMap(([, paths]) => paths),
  );
  for (const filePath of sourcePaths) {
    if (!/\.(?:ts|tsx)$/.test(filePath) || /\.(?:test|spec)\.(?:ts|tsx)$/.test(filePath)) continue;
    for (const testPath of [
      filePath.replace(/\.(ts|tsx)$/, ".test.$1"),
      filePath.replace(/\.(ts|tsx)$/, ".spec.$1"),
    ]) {
      if (fs.existsSync(path.join(root, testPath))) tests.add(testPath);
    }
  }
  return [...tests].sort();
}

const featureLayerToFlowSection = {
  ui: "ui",
  controller: "clientState",
  application: "application",
  domain: "domain",
  presentation: "presentation",
  api: "contract",
  transport: "transport",
};

function inferFlowLayerClosure(flow) {
  const closedLocalLayers = new Set(flow.closedLocalLayers ?? []);
  const explicitPaths = new Set(Object.values(flow.touchpoints).flat());
  const effectivePaths = new Set(explicitPaths);
  const inferredBySection = Object.fromEntries(
    requiredFlowSections.map((section) => [section, new Set()]),
  );
  const observedExceptionKeys = new Set();
  const errors = [];
  const queue = [...explicitPaths];
  const visited = new Set();
  const exceptions = flow.flowImportExceptions ?? {};

  while (queue.length > 0) {
    const filePath = queue.shift();
    if (visited.has(filePath)) continue;
    visited.add(filePath);
    const sourceMatch = filePath.match(/^src\/features\/([^/]+)\/([^/]+)\//);
    if (
      !sourceMatch ||
      !flow.participants.includes(sourceMatch[1]) ||
      !closedLocalLayers.has(sourceMatch[2]) ||
      !fs.existsSync(path.join(root, filePath)) ||
      !isProductionService(filePath)
    ) {
      continue;
    }
    const imports = extractImportSpecifiers(
      fs.readFileSync(path.join(root, filePath), "utf8"),
      filePath,
      { runtimeOnly: true },
    );
    for (const specifier of imports) {
      const target = resolveImport(filePath, specifier);
      const targetMatch = target?.match(/^src\/features\/([^/]+)\/([^/]+)\//);
      if (
        !target ||
        !targetMatch ||
        !closedLocalLayers.has(targetMatch[2]) ||
        !isProductionService(target)
      ) {
        continue;
      }
      const edgeKey = `${filePath}|${target}`;
      if (exceptions[edgeKey]) {
        observedExceptionKeys.add(edgeKey);
        continue;
      }
      if (!flow.participants.includes(targetMatch[1])) {
        errors.push(
          `${flow.id}: 자동 추적 import 대상 기능이 participants에서 빠졌습니다: ${filePath} -> ${target}`,
        );
        continue;
      }
      if (effectivePaths.has(target)) continue;
      effectivePaths.add(target);
      inferredBySection[featureLayerToFlowSection[targetMatch[2]]].add(target);
      queue.push(target);
    }
  }
  return { effectivePaths, errors, inferredBySection, observedExceptionKeys };
}

function inferFlowRuntimeDependencyClosure(registry, flow, seedPaths) {
  const trackedRuntimeFiles = new Map([
    ...registry.serviceOwners.map((entry) => ({ ...entry, section: "server" })),
    ...registry.serverOwners.map((entry) => ({ ...entry, section: "server" })),
    ...registry.featureServerOwners.map((entry) => ({ ...entry, section: "server" })),
    ...registry.adminContractOwners.map((entry) => ({ ...entry, section: "contract" })),
    ...registry.quizCoreOwners.map((entry) => ({ ...entry, section: "domain" })),
    ...registry.assignmentCoreOwners.map((entry) => ({ ...entry, section: "domain" })),
  ].map((entry) => [entry.path, entry]));
  const effectivePaths = new Set(seedPaths);
  const inferredBySection = Object.fromEntries(
    requiredFlowSections.map((section) => [section, new Set()]),
  );
  const observedFlowExceptionKeys = new Set();
  const observedServerExceptionKeys = new Set();
  const errors = [];
  const flowExceptions = flow.flowImportExceptions ?? {};
  const serverExceptions = flow.serverImportExceptions ?? {};
  const featureIds = new Set(registry.features.map(({ id }) => id));
  const closedLocalLayers = new Set(flow.closedLocalLayers ?? []);
  const queue = [...seedPaths];
  const visited = new Set();

  while (queue.length > 0) {
    const filePath = queue.shift();
    if (visited.has(filePath)) continue;
    visited.add(filePath);
    if (!fs.existsSync(path.join(root, filePath)) || !isProductionService(filePath)) continue;
    const imports = extractImportSpecifiers(
      fs.readFileSync(path.join(root, filePath), "utf8"),
      filePath,
      { runtimeOnly: true },
    );
    for (const specifier of imports) {
      const target = resolveImport(filePath, specifier);
      if (!target) continue;
      const featureMatch = target.match(
        /^src\/features\/([^/]+)\/(ui|controller|application|domain|presentation|api|transport)\//,
      );
      const tracked = trackedRuntimeFiles.get(target);
      if (!featureMatch && !tracked) continue;
      if (featureMatch && !closedLocalLayers.has(featureMatch[2])) continue;

      const edgeKey = `${filePath}|${target}`;
      const exceptionKind = featureMatch && flowExceptions[edgeKey]
        ? "flow"
        : serverExceptions[edgeKey]
          ? "server"
          : null;
      if (exceptionKind === "flow") {
        observedFlowExceptionKeys.add(edgeKey);
        continue;
      }
      if (exceptionKind === "server") {
        observedServerExceptionKeys.add(edgeKey);
        continue;
      }

      const targetOwner = featureMatch ? featureMatch[1] : tracked.owner;
      const targetSection = featureMatch
        ? featureLayerToFlowSection[featureMatch[2]]
        : tracked.section;
      if (featureIds.has(targetOwner) && !flow.participants.includes(targetOwner)) {
        errors.push(
          `${flow.id}: 자동 추적 실행 경로의 소유 기능이 participants에서 빠졌습니다: ${filePath} -> ${target}`,
        );
        continue;
      }
      if (effectivePaths.has(target)) continue;
      effectivePaths.add(target);
      inferredBySection[targetSection].add(target);
      queue.push(target);
    }
  }
  return {
    effectivePaths,
    errors,
    inferredBySection,
    observedFlowExceptionKeys,
    observedServerExceptionKeys,
  };
}

export function inferEffectiveFlow(registry, flow) {
  const layerClosure = inferFlowLayerClosure(flow);
  const runtimeSections = [
    "route",
    "serverComponent",
    "ui",
    "clientState",
    "application",
    "domain",
    "presentation",
    "contract",
    "transport",
    "server",
  ];
  const runtimeSeeds = new Set(
    runtimeSections.flatMap((section) => flow.touchpoints[section] ?? []),
  );
  const runtimeClosure = inferFlowRuntimeDependencyClosure(registry, flow, runtimeSeeds);
  const effectivePaths = new Set([
    ...layerClosure.effectivePaths,
    ...runtimeClosure.effectivePaths,
  ]);
  const inferredBySection = Object.fromEntries(
    requiredFlowSections.map((section) => [section, new Set(layerClosure.inferredBySection[section])]),
  );
  for (const section of requiredFlowSections) {
    for (const filePath of runtimeClosure.inferredBySection[section]) {
      inferredBySection[section].add(filePath);
    }
  }
  return {
    effectivePaths,
    errors: [...layerClosure.errors, ...runtimeClosure.errors],
    inferredBySection,
    observedFlowExceptionKeys: new Set([
      ...layerClosure.observedExceptionKeys,
      ...runtimeClosure.observedFlowExceptionKeys,
    ]),
    observedServerExceptionKeys: runtimeClosure.observedServerExceptionKeys,
  };
}

export function printFlow(registry, flowId) {
  const flow = registry.crossLayerFlows.find((candidate) => candidate.id === flowId);
  if (!flow) {
    const available = registry.crossLayerFlows.map(({ id }) => id).join(", ");
    throw new Error(`기능 흐름을 찾을 수 없습니다: ${flowId}\n사용 가능: ${available}`);
  }
  console.log(`\n[${flow.id}] ${flow.name}`);
  if (flow.status) console.log(`상태: ${flow.status}`);
  console.log(`최종 소유: ${flow.owner}`);
  console.log(`참여 기능: ${flow.participants.join(", ")}`);
  console.log(`자료 성격: ${flow.dataClass}`);
  console.log(`캐시: ${flow.cachePolicy}`);
  console.log(`점진 표시: ${flow.streamingPolicy}`);
  if (flow.knownGap) console.log(`남은 구조 차이: ${flow.knownGap}`);
  if ((flow.dependsOnFlows ?? []).length > 0) {
    console.log(`선행 공통 흐름: ${flow.dependsOnFlows.join(", ")}`);
  }
  if ((flow.closedLocalLayers ?? []).length > 0) {
    console.log(`실행 import 자동 추적: ${flow.closedLocalLayers.join(", ")}`);
  }
  const effectiveFlow = inferEffectiveFlow(registry, flow);
  for (const section of requiredFlowSections) {
    console.log(`\n${section}`);
    const paths = section === "tests"
      ? [...new Set([
          ...(flow.touchpoints.tests ?? []),
          ...inferredSiblingTests(flow, effectiveFlow.effectivePaths),
        ])].sort()
      : [...new Set([
          ...(flow.touchpoints[section] ?? []),
          ...(effectiveFlow.inferredBySection[section] ?? []),
        ])].sort();
    if (paths.length === 0) {
      console.log(`- 해당 없음: ${flow.notApplicable?.[section]}`);
      continue;
    }
    for (const filePath of paths) {
      const inferred = effectiveFlow.inferredBySection[section]?.has(filePath)
        ? " (자동 추적)"
        : "";
      console.log(`- ${filePath}${inferred}`);
    }
  }
  if ((flow.requiredImportEdges ?? []).length > 0) {
    console.log("\n필수 직접 연결");
    for (const edge of flow.requiredImportEdges) {
      console.log(`- ${edge.from} -> ${edge.to}: ${edge.reason}`);
    }
  }
  if (Object.keys(flow.flowImportExceptions ?? {}).length > 0) {
    console.log("\n분기 경계 예외");
    for (const [edge, reason] of Object.entries(flow.flowImportExceptions)) {
      console.log(`- ${edge}: ${reason}`);
    }
  }
  if (Object.keys(flow.serverImportExceptions ?? {}).length > 0) {
    console.log("\n서버 분기 경계 예외");
    for (const [edge, reason] of Object.entries(flow.serverImportExceptions)) {
      console.log(`- ${edge}: ${reason}`);
    }
  }
}
