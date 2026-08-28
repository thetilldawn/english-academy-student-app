const exactOwnershipDefinitions = [
  { key: "pageOwners", label: "page" },
  { key: "routeOwners", label: "Route Handler" },
  { key: "nextSpecialEntrypointOwners", label: "Next.js 특수 진입점" },
  { key: "nextConfigOwners", label: "Next.js 루트 설정" },
  { key: "appSupportOwners", label: "App Router 보조 파일" },
  { key: "serviceOwners", label: "server service", featureLabel: "현재 server service" },
  { key: "quizCoreOwners", label: "공유 시험 계산" },
  { key: "assignmentCoreOwners", label: "공유 배정 계산" },
  { key: "adminContractOwners", label: "관리자 계약" },
  { key: "componentOwners", label: "기존 공용 component", ownerLabel: "기존 component" },
  { key: "designSystemOwners", label: "공용 UI" },
  { key: "architectureGuardOwners", label: "구조 보호선" },
  { key: "libRootOwners", label: "lib 루트 공용 파일", ownerLabel: "lib 루트 파일" },
  { key: "serverOwners", label: "공통 server" },
  { key: "featureServerOwners", label: "기능 server" },
  { key: "migrationOwners", label: "migration" },
];

export function exactOwnershipCollections(registry) {
  return exactOwnershipDefinitions.map((definition) => ({
    ...definition,
    entries: registry[definition.key],
    featureLabel: definition.featureLabel ?? definition.label,
    ownerLabel: definition.ownerLabel ?? definition.label,
  }));
}

export function registeredOwnerForPath(registry, filePath) {
  for (const { entries } of exactOwnershipCollections(registry)) {
    const match = entries.find((entry) => entry.path === filePath);
    if (match) return match.owner;
  }
  for (const feature of registry.features) {
    if (filePath === feature.ownerPath || filePath.startsWith(`${feature.ownerPath}/`)) {
      return feature.id;
    }
  }
  if (filePath.startsWith("src/design-system/")) return "shared-ui";
  for (const entry of registry.libInfrastructureRoots ?? []) {
    if (filePath === entry.path || filePath.startsWith(`${entry.path}/`)) return entry.owner;
  }
  for (const entry of registry.srcSharedRoots ?? []) {
    if (filePath === entry.path || filePath.startsWith(`${entry.path}/`)) return entry.owner;
  }
  return null;
}
