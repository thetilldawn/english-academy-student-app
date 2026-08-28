import { exactOwnershipCollections } from "./ownership-catalog.mjs";

export function printFeature(registry, featureId) {
  const feature = registry.features.find((candidate) => candidate.id === featureId);
  if (!feature) return false;

  console.log(`\n[${feature.id}] ${feature.name}`);
  console.log(`기능 루트: ${feature.ownerPath}`);
  console.log(`가까운 안내서: ${feature.localGuide ?? "상위 src/features/AGENTS.md"}`);
  console.log("\n진입점");
  for (const entrypoint of feature.entrypoints ?? []) console.log(`- ${entrypoint}`);

  for (const { featureLabel: label, entries } of exactOwnershipCollections(registry)) {
    const paths = entries.filter((entry) => entry.owner === featureId).map((entry) => entry.path);
    if (paths.length === 0) continue;
    console.log(`\n${label}`);
    for (const filePath of paths) console.log(`- ${filePath}`);
  }

  const relatedFlows = registry.crossLayerFlows.filter(
    (flow) => flow.owner === featureId || flow.participants.includes(featureId),
  );
  console.log("\n관련 실행 흐름");
  if (relatedFlows.length === 0) console.log("- 등록된 상세 흐름 없음");
  for (const flow of relatedFlows) console.log(`- ${flow.id}: ${flow.name}`);

  const dependencies = [
    ...registry.currentCrossFeatureImports,
    ...registry.currentLibToFeatureImports,
    ...registry.currentFeatureToLibBridges,
    ...(registry.currentFeatureViaLibToFeatureImports ?? []),
  ].filter(({ from, to }) => {
    const fromFeature = from.match(/^src\/features\/([^/]+)\//)?.[1];
    const toFeature = to.match(/^src\/features\/([^/]+)\//)?.[1];
    return fromFeature === featureId || toFeature === featureId;
  });
  if (dependencies.length > 0) {
    console.log("\n현재 기능 간 의존");
    for (const edge of dependencies) {
      const via = Array.isArray(edge.via) ? ` (중계: ${edge.via.join(" -> ")})` : "";
      console.log(`- ${edge.from} -> ${edge.to}${via}`);
    }
  }
  return true;
}

export function printOwner(registry, ownerId) {
  const feature = registry.features.find((candidate) => candidate.id === ownerId);
  if (feature) return printFeature(registry, ownerId);
  if (!registry.specialOwners.includes(ownerId)) return false;

  console.log(`\n[${ownerId}] 공용 소유 범주`);
  let count = 0;
  for (const { ownerLabel: label, entries } of exactOwnershipCollections(registry)) {
    const paths = entries.filter((entry) => entry.owner === ownerId).map((entry) => entry.path);
    if (paths.length === 0) continue;
    console.log(`\n${label}`);
    for (const filePath of paths) console.log(`- ${filePath}`);
    count += paths.length;
  }
  const directories = [...registry.srcSharedRoots, ...registry.libInfrastructureRoots]
    .filter((entry) => entry.owner === ownerId)
    .map((entry) => entry.path);
  if (directories.length > 0) {
    console.log("\n소유 디렉터리");
    for (const directory of directories) console.log(`- ${directory}`);
    count += directories.length;
  }
  if (count === 0) console.log("\n- 현재 직접 등록된 경로 없음");
  return true;
}
