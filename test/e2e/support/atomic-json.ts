import { randomBytes } from "node:crypto";
import { mkdir, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";

let snapshotSequence = 0;

export async function writeJsonSnapshot(
  directory: string,
  stem: string,
  value: unknown,
) {
  if (!/^[a-z0-9-]+$/i.test(stem)) {
    throw new Error("JSON snapshot 이름에는 영문, 숫자, 하이픈만 사용할 수 있습니다.");
  }
  await mkdir(directory, { recursive: true });
  snapshotSequence += 1;
  const suffix = [
    Date.now(),
    process.pid,
    String(snapshotSequence).padStart(6, "0"),
    randomBytes(6).toString("hex"),
  ].join("-");
  const finalPath = path.join(directory, `${stem}.${suffix}.json`);
  const temporaryPath = `${finalPath}.tmp`;
  try {
    await writeFile(
      temporaryPath,
      `${JSON.stringify(value, null, 2)}\n`,
      { encoding: "utf8", flag: "wx" },
    );
    await rename(temporaryPath, finalPath);
    return finalPath;
  } finally {
    await rm(temporaryPath, { force: true }).catch(() => undefined);
  }
}
