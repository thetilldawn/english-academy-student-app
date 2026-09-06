import fs from "node:fs";
import path from "node:path";
import { exactOwnershipCollections, registeredOwnerForPath } from "../feature-map/ownership-catalog.mjs";
import { buildFlowPathIndex } from "../feature-map/change-impact.mjs";
import { isImplementationPath, resolveRecordPath } from "./evidence.mjs";
import { RECORD_DIRECTORY } from "./schema.mjs";

function walk(root, directory) {
  const absolute = resolveRecordPath(root, directory);
  if (!fs.existsSync(absolute)) return [];
  return fs.readdirSync(absolute, { withFileTypes: true }).flatMap((entry) => {
    const file = directory + "/" + entry.name;
    // Never follow symbolic directories while collecting evidence.
    if (entry.isSymbolicLink()) throw new Error("검사 입력의 심볼릭 링크는 명시적으로 검토하세요: " + file);
    return entry.isDirectory() ? walk(root, file) : [file];
  });
}

export function loadRecords(root) {
  const directory = RECORD_DIRECTORY + "/records";
  const absolute = resolveRecordPath(root, directory);
  if (!fs.existsSync(absolute)) throw new Error("작업 기록 폴더 없음: " + directory);
  const files = fs.readdirSync(absolute).filter((file) => file.endsWith(".json")).sort();
  if (!files.length) throw new Error("실제 작업 기록이 없습니다.");
  return files.map((file) => {
    const record = JSON.parse(fs.readFileSync(resolveRecordPath(root, directory + "/" + file), "utf8"));
    if (file !== record.id + ".json") throw new Error("작업 기록 파일명과 번호 불일치: " + file);
    return record;
  });
}

export function createContext(root) {
  const registry = JSON.parse(fs.readFileSync(path.join(root, "architecture/기능_소유권.json"), "utf8"));
  let flowIndex;
  const getFlows = () => flowIndex ??= buildFlowPathIndex(registry);
  const exact = exactOwnershipCollections(registry).flatMap((group) => group.entries);
  return {
    root,
    registry,
    owners: [...registry.features.map((item) => item.id), ...registry.specialOwners],
    featureOwners: registry.features.map((item) => item.id),
    flows: registry.crossLayerFlows.map((item) => item.id),
    ownerForPath(file) {
      return registeredOwnerForPath(registry, file) ??
        registry.retiredPathOwners?.find((item) => item.path === file)?.owner ??
        (/^(?:scripts|docs|architecture)\//.test(file) || /(^|\/)AGENTS\.md$/.test(file) ||
          ["00_앱_인계서.md", "package.json", "package-lock.json"].includes(file) ||
          /^(?:e2e|\.github\/workflows)\//.test(file) || /^[^/]+\.(?:[cm]?[jt]sx?|json)$/.test(file)
          ? "architecture-meta" : file.startsWith("public/") ? "app-shell" : null);
    },
    flowIdsForPath(file) { return getFlows().get(file) ?? []; },
    inputPaths(record) {
      const flowIds = new Set(record.scope.flatMap((item) => item.flowIds));
      const flowPaths = [...getFlows()].filter(([, ids]) => ids.some((id) => flowIds.has(id))).map(([file]) => file);
      const ownerPaths = exact.filter((entry) => record.owners.includes(entry.owner)).map((entry) => entry.path);
      const featurePaths = registry.features.filter((feature) => record.owners.includes(feature.id))
        .flatMap((feature) => walk(root, feature.ownerPath));
      return [...flowPaths, ...ownerPaths, ...featurePaths].filter(isImplementationPath);
    },
  };
}
