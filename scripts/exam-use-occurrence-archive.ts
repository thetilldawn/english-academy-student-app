import { createHash, randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { z } from "zod";

const row = z.object({ releaseId: z.uuid(), sourceRow: z.number().int().min(1).max(999_999_999), beforeText: z.string().min(2) }).strict();
const packet = z.object({ projectRef: z.string().regex(/^[a-z0-9]{20}$/), rows: z.array(row).min(1).max(100) }).strict();
const archive = z.object({ schemaVersion: z.literal("exam-use-occurrence-archive-v1"),
  hashFormat: z.literal("postgres-jsonb-text-sha256-v1"), origin: z.enum(["local-synthetic", "preview", "production"]),
  targetProjectRef: z.string().regex(/^[a-z0-9]{20}$/), packet }).strict();
type Archive = z.infer<typeof archive>;
const hash = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");
function outsideRepository(directory: string) {
  const resolved = fs.realpathSync(directory);
  for (let ancestor = resolved; ; ancestor = path.dirname(ancestor)) {
    if (fs.existsSync(path.join(ancestor, ".git"))) throw new Error("복구 사본은 모든 Git 저장소 밖의 접근 제한 폴더에 저장해야 합니다.");
    if (path.dirname(ancestor) === ancestor) break;
  }
  return resolved;
}
function validate(input: unknown) {
  const parsed = archive.parse(input), seen = new Set<string>();
  if (parsed.targetProjectRef !== parsed.packet.projectRef || Buffer.byteLength(JSON.stringify(parsed.packet)) > 16_777_216) {
    throw new Error("복구 사본의 대상 환경이나 묶음 크기를 확인해 주세요.");
  }
  for (const p of parsed.packet.rows) {
    const key = p.releaseId.toLowerCase() + ":" + p.sourceRow;
    if (seen.has(key)) throw new Error("같은 단어의 복구 사본이 중복되었습니다.");
    seen.add(key);
    if (Buffer.byteLength(p.beforeText) > 1_048_576) throw new Error("한 단어의 원행 보관 크기를 초과했습니다.");
    // Only inspect identity. Keep the PostgreSQL JSON string opaque so bigint
    // values and original JSON serialization are never rounded or rewritten.
    const original = JSON.parse(p.beforeText);
    if (original?.release_id?.toLowerCase() !== p.releaseId.toLowerCase() || original?.source_row !== p.sourceRow) {
      throw new Error("복구 사본의 자료판 번호나 단어 순번이 다릅니다.");
    }
  }
  return parsed;
}
/** Offline only. The operator verifies directory ACL and API project. */
export function saveExamUseOccurrenceArchive(directory: string, input: Archive) {
  const parsed = validate(input), bytes = Buffer.from(JSON.stringify(parsed));
  if (bytes.length > 33_554_432) throw new Error("복구 사본 파일의 허용 크기를 초과했습니다.");
  const filename = path.join(outsideRepository(directory), `exam-use-occurrences-${randomUUID()}.json`);
  const descriptor = fs.openSync(filename, "wx", 0o600);
  try { fs.writeFileSync(descriptor, bytes); fs.fsyncSync(descriptor); }
  finally { fs.closeSync(descriptor); }
  const sha256 = hash(bytes);
  return { path: filename, bytes: bytes.length, sha256, ...loadExamUseOccurrenceArchive(filename, sha256) };
}
export function loadExamUseOccurrenceArchive(filename: string, expectedSha256: string) {
  if (!/^[a-f0-9]{64}$/.test(expectedSha256)) throw new Error("사본 확인값이 올바르지 않습니다.");
  outsideRepository(path.dirname(fs.realpathSync(filename)));
  if (fs.statSync(filename).size > 33_554_432) throw new Error("복구 사본 파일의 허용 크기를 초과했습니다.");
  const bytes = fs.readFileSync(filename);
  if (hash(bytes) !== expectedSha256) throw new Error("복구 사본의 내용이 달라졌습니다.");
  const parsed = validate(JSON.parse(bytes.toString("utf8")));
  return { origin: parsed.origin, parameters: { p_target_project_ref: parsed.targetProjectRef,
    p_archive_sha256: expectedSha256, p_packet: parsed.packet } };
}
