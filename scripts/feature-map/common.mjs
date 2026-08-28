import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

export const root = process.cwd();
export const registryPath = path.join(root, "architecture", "기능_소유권.json");
export const changeTrackingFloor = "a4772624f254f56998bc1b02f0c013ffa950000c";
export const migrationOwnershipFloor = "20260828193000";
export const requiredFlowSections = [
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
  "database",
  "cacheStreaming",
  "tests",
];
export const closableFeatureLayers = new Set([
  "ui",
  "controller",
  "application",
  "domain",
  "presentation",
  "api",
  "transport",
]);

const nextSpecialUiStems = new Set([
  "default",
  "error",
  "forbidden",
  "global-error",
  "global-not-found",
  "layout",
  "loading",
  "not-found",
  "template",
  "unauthorized",
]);
const nextMetadataFilePattern = /^(?:favicon\.ico|(?:icon|apple-icon|opengraph-image|twitter-image)(?:-?\d+)?\.(?:ico|jpg|jpeg|png|svg|gif|webp|avif|ts|tsx|js|jsx)|(?:opengraph-image|twitter-image)\.alt\.txt|manifest\.(?:json|webmanifest|ts|js)|robots\.(?:txt|ts|js)|sitemap\.(?:xml|ts|js))$/;

export function isNextSpecialEntrypoint(filePath) {
  const fileName = path.basename(filePath);
  const match = fileName.match(/^(.+)\.[jt]sx?$/);
  return (match && nextSpecialUiStems.has(match[1])) || nextMetadataFilePattern.test(fileName);
}

export function normalize(filePath) {
  return filePath.replaceAll("\\", "/").replace(/^\.\//, "");
}

export function relative(filePath) {
  return normalize(path.relative(root, filePath));
}

export function walk(directory) {
  if (!fs.existsSync(directory)) return [];
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const fullPath = path.join(directory, entry.name);
    return entry.isDirectory() ? walk(fullPath) : [fullPath];
  });
}

export function loadRegistry() {
  if (!fs.existsSync(registryPath)) {
    throw new Error("architecture/기능_소유권.json이 없습니다.");
  }
  return JSON.parse(fs.readFileSync(registryPath, "utf8"));
}

export function assertPathExists(filePath, label, errors) {
  if (!fs.existsSync(path.join(root, filePath))) {
    errors.push(`${label}: 존재하지 않는 경로 ${filePath}`);
  }
}

export function duplicateValues(values) {
  const counts = new Map();
  for (const value of values) counts.set(value, (counts.get(value) ?? 0) + 1);
  return [...counts.entries()].filter(([, count]) => count > 1).map(([value]) => value);
}

export function compareExact(actual, registered, label, errors) {
  const actualSet = new Set(actual);
  const registeredSet = new Set(registered);
  for (const filePath of actualSet) {
    if (!registeredSet.has(filePath)) errors.push(`${label} 미등록: ${filePath}`);
  }
  for (const filePath of registeredSet) {
    if (!actualSet.has(filePath)) errors.push(`${label} 유령 경로: ${filePath}`);
  }
  for (const filePath of duplicateValues(registered)) {
    errors.push(`${label} 중복 등록: ${filePath}`);
  }
}

export function protectedMigrationDigest(files) {
  const digest = crypto.createHash("sha256");
  for (const filePath of files.toSorted()) {
    const fileDigest = crypto
      .createHash("sha256")
      .update(fs.readFileSync(path.join(root, filePath)))
      .digest("hex");
    digest.update(`${filePath}\0${fileDigest}\n`);
  }
  return digest.digest("hex");
}

export function pathSetDigest(files) {
  return crypto.createHash("sha256").update(`${files.toSorted().join("\n")}\n`).digest("hex");
}

export function verifyDirectorySnapshots(entries, label, validOwners, errors) {
  for (const entry of entries) {
    if (!validOwners.has(entry.owner)) {
      errors.push(`${label}의 알 수 없는 소유자: ${entry.path} -> ${entry.owner}`);
    }
    assertPathExists(entry.path, label, errors);
    const files = walk(path.join(root, entry.path)).map(relative).sort();
    if (entry.fileCount !== files.length) {
      errors.push(`${label} 파일 수 변화: ${entry.path} ${entry.fileCount} -> ${files.length}`);
    }
    const digest = pathSetDigest(files);
    if (entry.pathSetSha256 !== digest) {
      errors.push(`${label} 경로 묶음 변화: ${entry.path} ${entry.pathSetSha256} -> ${digest}`);
    }
  }
}

export function isProductionService(filePath) {
  return /\.[cm]?[jt]sx?$/.test(filePath) && !/\.(test|spec)\.[cm]?[jt]sx?$/.test(filePath);
}
