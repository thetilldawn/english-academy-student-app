import fs from "node:fs";
import path from "node:path";

import {
  assertPathExists,
  closableFeatureLayers,
  duplicateValues,
  requiredFlowSections,
  root,
} from "./common.mjs";
import { extractImportSpecifiers, resolveImport } from "./import-graph.mjs";
import { registeredOwnerForPath } from "./ownership-catalog.mjs";
import { inferEffectiveFlow, verifyFlowDependencyCycles } from "./runtime-flow.mjs";

export function verifyFlows(registry, featureIds, errors) {
  const cycleSelfTestErrors = [];
  verifyFlowDependencyCycles(
    [
      { id: "a", dependsOnFlows: ["b"] },
      { id: "b", dependsOnFlows: ["c"] },
      { id: "c", dependsOnFlows: ["a"] },
    ],
    cycleSelfTestErrors,
  );
  if (!cycleSelfTestErrors.some((message) => message.includes("a -> b -> c -> a"))) {
    errors.push("기능 흐름 선행 관계 순환 self-test가 실패했습니다.");
  }
  const flowIds = registry.crossLayerFlows.map((flow) => flow.id);
  for (const id of duplicateValues(flowIds)) errors.push(`기능 흐름 ID 중복: ${id}`);
  verifyFlowDependencyCycles(registry.crossLayerFlows, errors);

  for (const flow of registry.crossLayerFlows) {
    if (!featureIds.includes(flow.owner)) errors.push(`${flow.id}: 알 수 없는 최종 소유 기능 ${flow.owner}`);
    if (!Array.isArray(flow.participants) || flow.participants.length === 0) {
      errors.push(`${flow.id}: 참여 기능이 비었습니다.`);
    } else {
      for (const participant of duplicateValues(flow.participants)) {
        errors.push(`${flow.id}: 참여 기능 중복 ${participant}`);
      }
      for (const participant of flow.participants) {
        if (!featureIds.includes(participant)) errors.push(`${flow.id}: 알 수 없는 참여 기능 ${participant}`);
      }
      if (!flow.participants.includes(flow.owner)) {
        errors.push(`${flow.id}: 최종 소유 기능 ${flow.owner}가 participants에 없습니다.`);
      }
    }
    if (!["private", "shared", "mutation"].includes(flow.dataClass)) {
      errors.push(`${flow.id}: dataClass는 private/shared/mutation 중 하나여야 합니다.`);
    }
    if (typeof flow.cachePolicy !== "string" || flow.cachePolicy.length === 0) {
      errors.push(`${flow.id}: cachePolicy가 없습니다.`);
    }
    if (typeof flow.streamingPolicy !== "string" || flow.streamingPolicy.length === 0) {
      errors.push(`${flow.id}: streamingPolicy가 없습니다.`);
    }
    for (const dependencyId of duplicateValues(flow.dependsOnFlows ?? [])) {
      errors.push(`${flow.id}: 선행 흐름 중복 ${dependencyId}`);
    }
    for (const dependencyId of flow.dependsOnFlows ?? []) {
      if (!flowIds.includes(dependencyId)) errors.push(`${flow.id}: 알 수 없는 선행 흐름 ${dependencyId}`);
      if (dependencyId === flow.id) errors.push(`${flow.id}: 자기 자신을 선행 흐름으로 지정할 수 없습니다.`);
    }

    for (const section of requiredFlowSections) {
      const paths = flow.touchpoints?.[section];
      if (!Array.isArray(paths) || paths.length === 0) {
        const reason = flow.notApplicable?.[section];
        if (typeof reason !== "string" || reason.length === 0) {
          errors.push(`${flow.id}: ${section} 경로 또는 해당 없음 근거가 없습니다.`);
        }
        continue;
      }
      if (flow.notApplicable?.[section]) {
        errors.push(`${flow.id}: ${section}에 경로와 해당 없음 근거를 동시에 선언했습니다.`);
      }
      for (const filePath of duplicateValues(paths)) {
        errors.push(`${flow.id}: ${section} 경로 중복 ${filePath}`);
      }
      for (const filePath of paths) {
        assertPathExists(filePath, `${flow.id}/${section}`, errors);
        const pathOwner = registeredOwnerForPath(registry, filePath);
        if (
          pathOwner &&
          featureIds.includes(pathOwner) &&
          pathOwner !== flow.owner &&
          !flow.participants.includes(pathOwner)
        ) {
          errors.push(`${flow.id}/${section}: ${filePath}의 소유 기능 ${pathOwner}가 participants에 없습니다.`);
        }
      }
    }

    for (const layer of duplicateValues(flow.closedLocalLayers ?? [])) {
      errors.push(`${flow.id}: 닫힘 검사 계층 중복 ${layer}`);
    }
    for (const layer of new Set(flow.closedLocalLayers ?? [])) {
      if (!closableFeatureLayers.has(layer)) errors.push(`${flow.id}: 닫힘 검사 대상이 아닌 기능 계층 ${layer}`);
    }
    const effectiveFlow = inferEffectiveFlow(registry, flow);
    errors.push(...effectiveFlow.errors);
    for (const section of requiredFlowSections) {
      if (flow.notApplicable?.[section] && effectiveFlow.inferredBySection[section].size > 0) {
        errors.push(
          `${flow.id}: ${section}은 해당 없음으로 선언됐지만 실행 import가 자동 추적됐습니다: ` +
            [...effectiveFlow.inferredBySection[section]].join(", "),
        );
      }
    }

    verifyImportExceptions(flow, effectiveFlow, errors);
    verifyRequiredImportEdges(flow, effectiveFlow.effectivePaths, errors);
    verifyEntrypoints(flow, effectiveFlow, errors);
  }
  return flowIds;
}

function verifyImportExceptions(flow, effectiveFlow, errors) {
  for (const [edgeKey, reason] of Object.entries(flow.flowImportExceptions ?? {})) {
    if (!effectiveFlow.observedFlowExceptionKeys.has(edgeKey)) {
      errors.push(`${flow.id}: 실제 직접 import가 아닌 흐름 예외 ${edgeKey}`);
    }
    if (typeof reason !== "string" || reason.length === 0) {
      errors.push(`${flow.id}: 흐름 import 예외 근거가 없습니다: ${edgeKey}`);
    }
  }
  for (const [edgeKey, reason] of Object.entries(flow.serverImportExceptions ?? {})) {
    if (!effectiveFlow.observedServerExceptionKeys.has(edgeKey)) {
      errors.push(`${flow.id}: 실제 직접 import가 아닌 server 흐름 예외 ${edgeKey}`);
    }
    if (typeof reason !== "string" || reason.length === 0) {
      errors.push(`${flow.id}: server 흐름 import 예외 근거가 없습니다: ${edgeKey}`);
    }
  }
}

function verifyRequiredImportEdges(flow, flowPaths, errors) {
  const requiredImportEdges = flow.requiredImportEdges ?? [];
  for (const edgeKey of duplicateValues(requiredImportEdges.map(({ from, to }) => `${from}|${to}`))) {
    errors.push(`${flow.id}: 필수 import 간선 중복 ${edgeKey}`);
  }
  for (const edge of requiredImportEdges) {
    assertPathExists(edge.from, `${flow.id}/필수 import 출발`, errors);
    assertPathExists(edge.to, `${flow.id}/필수 import 대상`, errors);
    if (!flowPaths.has(edge.from) || !flowPaths.has(edge.to)) {
      errors.push(`${flow.id}: 필수 import 양끝이 기능 흐름에 모두 등록돼야 합니다: ${edge.from} -> ${edge.to}`);
      continue;
    }
    if (!fs.existsSync(path.join(root, edge.from))) continue;
    const imports = extractImportSpecifiers(fs.readFileSync(path.join(root, edge.from), "utf8"), edge.from, {
      runtimeOnly: true,
    });
    const resolvedTargets = new Set(
      [...imports].map((specifier) => resolveImport(edge.from, specifier)).filter(Boolean),
    );
    if (!resolvedTargets.has(edge.to)) {
      errors.push(`${flow.id}: 실제 import가 없는 필수 간선 ${edge.from} -> ${edge.to}`);
    }
    if (typeof edge.reason !== "string" || edge.reason.length === 0) {
      errors.push(`${flow.id}: 필수 import 간선 설명 누락 ${edge.from} -> ${edge.to}`);
    }
  }
}

function verifyEntrypoints(flow, effectiveFlow, errors) {
  const entryPaths = new Set([
    ...(flow.touchpoints.route ?? []),
    ...(flow.touchpoints.serverComponent ?? []),
  ]);
  const exceptions = flow.entryImportExceptions ?? {};
  for (const [entryPath, reason] of Object.entries(exceptions)) {
    if (!entryPaths.has(entryPath)) errors.push(`${flow.id}: 진입점 예외가 route/serverComponent에 없습니다: ${entryPath}`);
    if (typeof reason !== "string" || reason.length === 0) {
      errors.push(`${flow.id}: 진입점 예외 근거가 없습니다: ${entryPath}`);
    }
  }
  for (const entryPath of entryPaths) {
    if (!fs.existsSync(path.join(root, entryPath))) continue;
    const imports = extractImportSpecifiers(fs.readFileSync(path.join(root, entryPath), "utf8"), entryPath, {
      runtimeOnly: true,
    });
    const allowedTargets = /\/route\.[cm]?[jt]sx?$/.test(entryPath)
      ? new Set([...(flow.touchpoints.server ?? []), ...effectiveFlow.inferredBySection.server])
      : new Set([
          ...(flow.touchpoints.ui ?? []),
          ...effectiveFlow.inferredBySection.ui,
          ...effectiveFlow.inferredBySection.server,
          ...(flow.touchpoints.server ?? []),
        ]);
    const internalTargets = [...imports]
      .map((specifier) => resolveImport(entryPath, specifier))
      .filter((target) => target && allowedTargets.has(target));
    if (internalTargets.length === 0 && !exceptions[entryPath]) {
      errors.push(`${flow.id}: 진입점에서 UI 또는 서버 실행 경로로 이어지는 import가 없습니다: ${entryPath}`);
    }
  }
}
