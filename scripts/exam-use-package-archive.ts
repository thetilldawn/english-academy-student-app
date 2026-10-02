import { createHash, randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { z } from "zod";

// Preserve PostgreSQL JSON text without JavaScript number conversion. This is
// a DB-row backup, not a replacement for the original approved import file.
const packet = z.object({ id: z.uuid(), projectRef: z.string().regex(/^[a-z0-9]{20}$/), beforeText: z.string().min(2) }).strict();
const archive = z.object({
  schemaVersion: z.literal("exam-use-package-archive-v1"),
  hashFormat: z.literal("postgres-jsonb-text-sha256-v1"),
  origin: z.enum(["local-synthetic", "preview", "production"]),
  targetProjectRef: z.string().regex(/^[a-z0-9]{20}$/),
  packet,
}).strict();
type Archive = z.infer<typeof archive>;
const hash = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");
function outsideRepository(directory: string) {
  const resolved = fs.realpathSync(directory);
  for (let ancestor = resolved; ; ancestor = path.dirname(ancestor)) {
    if (fs.existsSync(path.join(ancestor, ".git"))) {
      throw new Error("복구 사본은 모든 Git 저장소 밖의 접근 제한 폴더에 저장해야 합니다.");
    }
    if (path.dirname(ancestor) === ancestor) break;
  }
  return resolved;
}
function validate(input: unknown) {
  const parsed = archive.parse(input);
  if (Buffer.byteLength(parsed.packet.beforeText, "utf8") > 16_777_216) {
    throw new Error("원자료 한 묶음의 보관 크기를 초과했습니다.");
  }
  // Inspect identity only. Never reserialize this parsed row.
  const row = JSON.parse(parsed.packet.beforeText);
  if (row?.release_id?.toLowerCase() !== parsed.packet.id.toLowerCase() || parsed.packet.projectRef !== parsed.targetProjectRef) {
    throw new Error("복구 사본의 자료 번호나 대상 환경이 다릅니다.");
  }
  return parsed;
}
/** No DB/network access. Caller must verify directory ACL and API project. */
export function saveExamUsePackageArchive(directory: string, input: Archive) {
  const parsed = validate(input);
  const bytes = Buffer.from(JSON.stringify(parsed));
  if (bytes.length > 33_554_432) throw new Error("복구 사본 파일의 허용 크기를 초과했습니다.");
  const filename = path.join(outsideRepository(directory), `exam-use-package-${randomUUID()}.json`);
  const descriptor = fs.openSync(filename, "wx", 0o600);
  try { fs.writeFileSync(descriptor, bytes); fs.fsyncSync(descriptor); }
  finally { fs.closeSync(descriptor); }
  const sha256 = hash(bytes);
  return { path: filename, bytes: bytes.length, sha256, ...loadExamUsePackageArchive(filename, sha256) };
}
export function loadExamUsePackageArchive(filename: string, expectedSha256: string) {
  if (!/^[a-f0-9]{64}$/.test(expectedSha256)) throw new Error("사본 확인값이 올바르지 않습니다.");
  outsideRepository(path.dirname(fs.realpathSync(filename)));
  if (fs.statSync(filename).size > 33_554_432) throw new Error("복구 사본 파일의 허용 크기를 초과했습니다.");
  const bytes = fs.readFileSync(filename);
  if (hash(bytes) !== expectedSha256) throw new Error("복구 사본의 내용이 달라졌습니다.");
  const parsed = validate(JSON.parse(bytes.toString("utf8")));
  return { origin: parsed.origin, parameters: { p_target_project_ref: parsed.targetProjectRef,
    p_archive_sha256: expectedSha256, p_packet: parsed.packet } };
}
