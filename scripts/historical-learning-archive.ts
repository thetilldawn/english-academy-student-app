import { createHash, randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";

// The row is an opaque PostgreSQL JSON string. Parsing and serializing its
// numeric values in JavaScript would silently round large bigint identifiers.
const packet = z.object({ id: z.uuid(), beforeText: z.string().min(2) }).strict();
const archive = z.object({
  schemaVersion: z.literal("historical-learning-archive-v1"),
  origin: z.enum(["local-synthetic", "preview", "production"]),
  packets: z.array(packet).min(1).max(100),
}).strict().refine(value => new Set(value.packets.map(p => p.id.toLowerCase())).size === value.packets.length,
  "같은 자료의 복구 사본이 중복되었습니다.");
type Archive = z.infer<typeof archive>;
const appDirectory = fs.realpathSync(path.resolve(path.dirname(fileURLToPath(import.meta.url)), ".."));
const hash = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");
function outsideRepository(directory: string) {
  const resolved = fs.realpathSync(directory);
  const relative = path.relative(appDirectory.toLowerCase(), resolved.toLowerCase());
  if (!relative || (!relative.startsWith(".." + path.sep) && relative !== ".." && !path.isAbsolute(relative))) {
    throw new Error("복구 사본은 앱 저장소 밖의 접근 제한 폴더에 저장해야 합니다.");
  }
  for (let ancestor = resolved; ; ancestor = path.dirname(ancestor)) {
    if (fs.existsSync(path.join(ancestor, ".git"))) {
      throw new Error("복구 사본은 모든 Git 저장소 밖의 접근 제한 폴더에 저장해야 합니다.");
    }
    if (path.dirname(ancestor) === ancestor) break;
  }
  return resolved;
}

/** Offline operator tool. The caller verifies folder access before use. */
export function saveHistoricalLearningArchive(directory: string, input: Archive) {
  const parsed = archive.parse(input);
  const bytes = Buffer.from(JSON.stringify(parsed));
  if (bytes.length > 4_194_304) throw new Error("복구 사본 묶음을 더 작게 나눠 주세요.");
  const destination = path.join(outsideRepository(directory), `historical-learning-${randomUUID()}.json`);
  const descriptor = fs.openSync(destination, "wx", 0o600);
  try { fs.writeFileSync(descriptor, bytes); fs.fsyncSync(descriptor); }
  finally { fs.closeSync(descriptor); }
  const sha256 = hash(bytes);
  return { path: destination, bytes: bytes.length, sha256, ...loadHistoricalLearningArchive(destination, sha256) };
}

export function loadHistoricalLearningArchive(filename: string, expectedSha256: string) {
  if (!/^[a-f0-9]{64}$/.test(expectedSha256)) throw new Error("사본 확인값이 올바르지 않습니다.");
  outsideRepository(path.dirname(fs.realpathSync(filename)));
  if (fs.statSync(filename).size > 4_194_304) throw new Error("복구 사본이 허용 크기를 넘었습니다.");
  const bytes = fs.readFileSync(filename);
  if (hash(bytes) !== expectedSha256) throw new Error("복구 사본의 내용이 달라졌습니다.");
  const parsed = archive.parse(JSON.parse(bytes.toString("utf8")));
  return { origin: parsed.origin, parameters: { p_archive_sha256: expectedSha256, p_rows: parsed.packets } };
}
