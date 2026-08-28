import { spawnSync } from "node:child_process";

import {
  changeTrackingFloor,
  migrationOwnershipFloor,
  normalize,
  root,
} from "./common.mjs";
import { inferEffectiveFlow, inferredSiblingTests } from "./runtime-flow.mjs";
import { exactOwnershipCollections } from "./ownership-catalog.mjs";

function gitLines(args) {
  const result = spawnSync("git", ["-c", "core.quotepath=false", ...args], {
    cwd: root,
    encoding: "utf8",
  });
  if (result.status !== 0) throw new Error(result.stderr.trim() || `git ${args.join(" ")} 실패`);
  return result.stdout.split(/\r?\n/).map(normalize).filter(Boolean);
}

function gitRefExists(ref) {
  const result = spawnSync("git", ["rev-parse", "--verify", "--quiet", ref], {
    cwd: root,
    encoding: "utf8",
  });
  return result.status === 0;
}

function mergeBase(ref) {
  if (!ref) return null;
  const result = spawnSync("git", ["merge-base", ref, "HEAD"], {
    cwd: root,
    encoding: "utf8",
  });
  if (result.status !== 0) {
    throw new Error(result.stderr.trim() || `${ref}와 HEAD의 공통 기준을 찾지 못했습니다.`);
  }
  return result.stdout.trim();
}

function registryAt(ref) {
  if (!ref) return null;
  const result = spawnSync(
    "git",
    ["-c", "core.quotepath=false", "show", `${ref}:architecture/기능_소유권.json`],
    { cwd: root, encoding: "utf8" },
  );
  if (result.status !== 0) return null;
  try {
    return JSON.parse(result.stdout);
  } catch {
    throw new Error(`${ref}의 이전 기능 소유권 지도를 읽지 못했습니다.`);
  }
}

export function automaticChangeBase() {
  const candidates = [
    process.env.FEATURE_MAP_BASE_REF,
    process.env.GITHUB_BASE_REF ? `origin/${process.env.GITHUB_BASE_REF}` : null,
    process.env.VERCEL_GIT_PREVIOUS_SHA,
    changeTrackingFloor,
  ].filter(Boolean);
  const base = candidates.find(gitRefExists);
  if (!base) throw new Error("변경 영향 비교 기준을 찾지 못했습니다. --base <git-ref>를 지정하세요.");
  return base;
}

function changedFileState(baseRef = null) {
  const committed = baseRef ? gitLines(["diff", "--name-only", `${baseRef}...HEAD`]) : [];
  const changed = [...new Set([
    ...committed,
    ...gitLines(["diff", "--name-only", "HEAD"]),
    ...gitLines(["diff", "--cached", "--name-only"]),
    ...gitLines(["ls-files", "--others", "--exclude-standard"]),
  ])].sort();
  const deletedFromBase = new Set(
    baseRef
      ? gitLines(["diff", "--no-renames", "--diff-filter=D", "--name-only", `${baseRef}...HEAD`])
      : [],
  );
  const deletedFromHead = new Set([
    ...gitLines(["diff", "--no-renames", "--diff-filter=D", "--name-only", "HEAD"]),
    ...gitLines(["diff", "--cached", "--no-renames", "--diff-filter=D", "--name-only"]),
  ]);
  return {
    changed: [...new Set([...changed, ...deletedFromBase, ...deletedFromHead])].sort(),
    deleted: new Set([...deletedFromBase, ...deletedFromHead]),
    deletedFromBase,
    deletedFromHead,
  };
}

function buildFlowPathIndex(registry) {
  const index = new Map();
  const flowById = new Map(registry.crossLayerFlows.map((flow) => [flow.id, flow]));
  const ownPathsByFlow = new Map();
  for (const flow of registry.crossLayerFlows) {
    const effectiveFlow = inferEffectiveFlow(registry, flow);
    ownPathsByFlow.set(flow.id, new Set([
      ...effectiveFlow.effectivePaths,
      ...inferredSiblingTests(flow, effectiveFlow.effectivePaths),
    ]));
  }
  const transitivePathsByFlow = new Map();
  const pathsForFlow = (flowId, visiting = new Set()) => {
    if (transitivePathsByFlow.has(flowId)) return transitivePathsByFlow.get(flowId);
    if (visiting.has(flowId)) return ownPathsByFlow.get(flowId) ?? new Set();
    const nextVisiting = new Set(visiting).add(flowId);
    const paths = new Set(ownPathsByFlow.get(flowId) ?? []);
    for (const dependencyId of flowById.get(flowId)?.dependsOnFlows ?? []) {
      for (const filePath of pathsForFlow(dependencyId, nextVisiting)) paths.add(filePath);
    }
    transitivePathsByFlow.set(flowId, paths);
    return paths;
  };
  for (const flow of registry.crossLayerFlows) {
    const paths = pathsForFlow(flow.id);
    for (const filePath of paths) {
      const flowIds = index.get(filePath) ?? [];
      flowIds.push(flow.id);
      index.set(filePath, flowIds);
    }
  }
  return index;
}

function buildDeclaredFlowPathIndex(registry) {
  const ownPathsByFlow = new Map(
    registry.crossLayerFlows.map((flow) => [
      flow.id,
      new Set(Object.values(flow.touchpoints ?? {}).flat()),
    ]),
  );
  const flowById = new Map(registry.crossLayerFlows.map((flow) => [flow.id, flow]));
  const transitivePaths = new Map();
  const pathsForFlow = (flowId, visiting = new Set()) => {
    if (transitivePaths.has(flowId)) return transitivePaths.get(flowId);
    if (visiting.has(flowId)) return ownPathsByFlow.get(flowId) ?? new Set();
    const paths = new Set(ownPathsByFlow.get(flowId) ?? []);
    const nextVisiting = new Set(visiting).add(flowId);
    for (const dependencyId of flowById.get(flowId)?.dependsOnFlows ?? []) {
      for (const filePath of pathsForFlow(dependencyId, nextVisiting)) paths.add(filePath);
    }
    transitivePaths.set(flowId, paths);
    return paths;
  };
  const index = new Map();
  for (const flow of registry.crossLayerFlows) {
    for (const filePath of pathsForFlow(flow.id)) {
      const flowIds = index.get(filePath) ?? [];
      flowIds.push(flow.id);
      index.set(filePath, flowIds);
    }
  }
  return index;
}

function ownersForPath(registry, filePath, flowPathIndex) {
  const owners = new Set();
  const flows = flowPathIndex.get(filePath) ?? [];
  for (const { entries } of exactOwnershipCollections(registry)) {
    const match = entries.find((entry) => entry.path === filePath);
    if (match) owners.add(match.owner);
  }
  for (const feature of registry.features) {
    if (filePath === feature.ownerPath || filePath.startsWith(`${feature.ownerPath}/`)) {
      owners.add(feature.id);
    }
  }
  for (const entry of registry.libInfrastructureRoots ?? []) {
    if (filePath === entry.path || filePath.startsWith(`${entry.path}/`)) owners.add(entry.owner);
  }
  for (const entry of registry.srcSharedRoots ?? []) {
    if (filePath === entry.path || filePath.startsWith(`${entry.path}/`)) owners.add(entry.owner);
  }
  if (filePath.startsWith("src/design-system/")) owners.add("shared-ui");
  if (
    /^(architecture|docs|scripts)\//.test(filePath) ||
    /(^|\/)AGENTS\.md$/.test(filePath) ||
    ["00_앱_인계서.md", "package.json"].includes(filePath)
  ) {
    owners.add("architecture-meta");
  }
  return { owners: [...owners], flows };
}

export function printChangedImpact(registry, baseRef = null) {
  const { changed, deleted, deletedFromBase, deletedFromHead } = changedFileState(baseRef);
  const flowPathIndex = buildFlowPathIndex(registry);
  const baseSnapshotRef = mergeBase(baseRef);
  const baseRegistry = registryAt(baseSnapshotRef);
  const headRegistry = registryAt("HEAD");
  const baseFlowPathIndex = baseRegistry ? buildDeclaredFlowPathIndex(baseRegistry) : null;
  const headFlowPathIndex = headRegistry ? buildDeclaredFlowPathIndex(headRegistry) : null;
  const unmapped = [];
  const missingFlow = [];
  const protectedMigrationChanges = changed.filter((filePath) => {
    const match = filePath.match(/^supabase\/migrations\/(\d+)[^/]*\.sql$/);
    return match && match[1] < migrationOwnershipFloor;
  });
  if (protectedMigrationChanges.length > 0) {
    throw new Error(
      "기존 migration은 새 forward migration으로만 변경하세요:\n" +
        protectedMigrationChanges.map((filePath) => `- ${filePath}`).join("\n"),
    );
  }
  const detailedFlowOwners = new Set(["assignments", "assignment-queue", "history", "quiz-player"]);
  const mappedChanges = changed.map((filePath) => {
    const current = ownersForPath(registry, filePath, flowPathIndex);
    const previous = deletedFromHead.has(filePath) && headRegistry
      ? ownersForPath(headRegistry, filePath, headFlowPathIndex)
      : deletedFromBase.has(filePath) && baseRegistry
        ? ownersForPath(baseRegistry, filePath, baseFlowPathIndex)
        : { owners: [], flows: [] };
    const mapped = {
      owners: [...new Set([...current.owners, ...previous.owners])],
      flows: [...new Set([...current.flows, ...previous.flows])],
    };
    return { filePath, current, previous, mapped, deleted: deleted.has(filePath) };
  });
  const changedFlowsByOwner = new Map();
  for (const { mapped } of mappedChanges) {
    if (mapped.flows.length === 0) continue;
    for (const owner of mapped.owners) {
      const flows = changedFlowsByOwner.get(owner) ?? new Set();
      for (const flow of mapped.flows) flows.add(flow);
      changedFlowsByOwner.set(owner, flows);
    }
  }

  console.log(`\n변경 파일 영향 지도${baseRef ? ` (${baseRef}...HEAD + 작업 트리)` : " (작업 트리)"}`);
  for (const change of mappedChanges) {
    const { filePath, current, previous, mapped } = change;
    const contextualFlows = change.deleted && mapped.flows.length === 0
      ? [...new Set(mapped.owners.flatMap((owner) => [...(changedFlowsByOwner.get(owner) ?? [])]))]
      : [];
    if (contextualFlows.length > 0) mapped.flows.push(...contextualFlows);
    const labels = [
      ...current.owners,
      ...current.flows.map((flow) => `flow:${flow}`),
      ...previous.owners.map((owner) => `이전 소유:${owner}`),
      ...previous.flows.map((flow) => `이전 flow:${flow}`),
      ...contextualFlows.map((flow) => `관련 변경 flow:${flow}`),
      ...(change.deleted ? ["삭제·이동 전 경로"] : []),
    ];
    console.log(`- ${filePath}: ${labels.length > 0 ? labels.join(", ") : "지도 밖"}`);
    const mustMap = /^(src|supabase\/migrations)\//.test(filePath);
    if (mustMap && mapped.owners.length === 0 && mapped.flows.length === 0) unmapped.push(filePath);
    const needsDetailedFlow =
      mustMap &&
      !mapped.owners.includes("architecture-meta") &&
      mapped.owners.some((owner) => detailedFlowOwners.has(owner));
    if (needsDetailedFlow && mapped.flows.length === 0) {
      missingFlow.push(filePath);
    }
  }
  if (unmapped.length > 0) {
    throw new Error(`변경 영향 미등록 경로:\n${unmapped.map((file) => `- ${file}`).join("\n")}`);
  }
  if (missingFlow.length > 0) {
    throw new Error(
      `상세 기능 흐름 미등록 변경:\n${missingFlow.map((file) => `- ${file}`).join("\n")}\n` +
        "해당 파일을 기존 crossLayerFlows에 연결하거나 새 기능 흐름을 등록하세요.",
    );
  }
}
