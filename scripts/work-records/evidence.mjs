import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { isSafeRelativePath, RECORD_DIRECTORY } from "./schema.mjs";

export function resolveRecordPath(root, file) {
  if (!isSafeRelativePath(file)) throw new Error("허용되지 않은 기록 경로: " + file);
  const resolvedRoot = fs.realpathSync(root);
  const absolute = path.resolve(resolvedRoot, file);
  let parent = absolute;
  while (!fs.existsSync(parent)) parent = path.dirname(parent);
  const realParent = fs.realpathSync(parent);
  const relation = path.relative(resolvedRoot, realParent);
  if (relation === ".." || relation.startsWith(".." + path.sep) || path.isAbsolute(relation)) {
    throw new Error("앱 밖을 가리키는 기록 경로: " + file);
  }
  return absolute;
}

export function fileExists(root, file) {
  const absolute = resolveRecordPath(root, file);
  return fs.existsSync(absolute) && fs.statSync(absolute).isFile();
}

export function isImplementationPath(file) {
  if (!isSafeRelativePath(file) || file.startsWith(RECORD_DIRECTORY + "/records/")) return false;
  return (/^(?:src|scripts|supabase|e2e|test)\//.test(file) && !/\.md$/i.test(file)) ||
    /^[^/]+\.(?:[cm]?[jt]sx?|json)$/.test(file) ||
    /^\.github\/workflows\/[^/]+\.ya?ml$/.test(file) ||
    /^public\//.test(file) || file === "architecture/기능_소유권.json" ||
    file.startsWith(RECORD_DIRECTORY + "/examples/") && file.endsWith(".json");
}

function hash(value) {
  return createHash("sha256").update(value).digest("hex");
}

function hashFile(file, absolute) {
  const bytes = fs.readFileSync(absolute);
  // Git may check text out with CRLF on Windows and LF in CI. v1 compares LF text;
  // binary assets retain their exact bytes. No whitespace other than CRLF is changed.
  const textFile = /\.(?:[cm]?[jt]sx?|css|json|sql|ya?ml|toml|svg|txt|xml|html|webmanifest)$/.test(file);
  return hash(textFile ? bytes.toString("utf8").replace(/\r\n/g, "\n") : bytes);
}

function stable(value) {
  if (Array.isArray(value)) return value.map(stable);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.keys(value).sort().map((key) => [key, stable(value[key])]));
  }
  return value;
}

export function fingerprintForInputs(record, files) {
  const { gate: _gate, verification: _verification, ...design } = record;
  void _gate;
  void _verification;
  return hash(JSON.stringify(stable({ design, files })));
}

export function captureFingerprint(record, context) {
  const candidates = new Set([
    ...record.scope.map((item) => item.path),
    ...record.checks.map((item) => item.target).filter(Boolean),
    ...record.uiStates.map((item) => item.component),
    ...context.inputPaths(record),
    "package.json", "package-lock.json", "tsconfig.json",
    "vitest.config.ts", "eslint.config.mjs", "next.config.ts",
    "architecture/기능_소유권.json",
  ]);
  const files = [...candidates].filter(isImplementationPath).sort().map((file) => {
    const absolute = resolveRecordPath(context.root, file);
    return {
      path: file,
      sha256: fs.existsSync(absolute) ? hashFile(file, absolute) : null,
    };
  });
  return { fingerprint: fingerprintForInputs(record, files), files };
}
