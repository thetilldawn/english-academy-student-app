// Installed only by the local baseline launcher in its build/start child processes.
import fs from "node:fs";
import path from "node:path";
import { APP_ORIGIN, DATA_ORIGIN, NEXT_ORIGIN, PUBLIC_KEY } from "./local-admin-baseline-data.mjs";

export function assertLocalBaselineEnvironment(env, root) {
  if (env.VERCEL || env.VERCEL_ENV || env.CI || env.LOCAL_ADMIN_BASELINE !== "fake-read-only-v1") {
    throw new Error("명시적인 로컬 검사 환경에서만 실행할 수 있습니다.");
  }
  if (env.APP_ORIGIN !== APP_ORIGIN || env.NEXT_PUBLIC_SUPABASE_URL !== DATA_ORIGIN ||
      env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY !== PUBLIC_KEY) {
    throw new Error("가짜 로컬 연결값만 허용됩니다.");
  }
  if (fs.readdirSync(root).some(name => /^\.env(?:\.|$)/i.test(name) && name !== ".env.example")) {
    throw new Error("실제 환경 파일이 있는 작업 폴더에서는 검사 서버를 시작할 수 없습니다.");
  }
}
export function assertLocalFetchTarget(input) {
  const value = typeof input === "string" || input instanceof URL ? input : input.url;
  const target = new URL(value);
  if (![DATA_ORIGIN, APP_ORIGIN, NEXT_ORIGIN].includes(target.origin) || target.username || target.password) {
    throw new Error("허용되지 않은 검사 요청입니다.");
  }
  return target;
}
export function guardedFetch(originalFetch) {
  return (input, init) => {
    assertLocalFetchTarget(input);
    return originalFetch(input, { ...init, redirect: "error" });
  };
}
export function assertNestedPath(root, target, paths = path) {
  const relative = paths.relative(root, target);
  if (!relative || relative === ".." || relative.startsWith(".." + paths.sep) || paths.isAbsolute(relative)) {
    throw new Error("검사 경로가 앱 안에 있지 않습니다.");
  }
}
export function waitForChild(child) {
  return new Promise((resolve, reject) => { child.once("exit", resolve); child.once("error", reject); });
}
export function assertMayStart(stopping) {
  if (stopping) throw new Error("종료 요청 뒤에는 검사 서버를 새로 시작하지 않습니다.");
}
export function isRestorationSafe(states) {
  return states.every(state => state.treeStopped || state.spawnFailed ||
    (state.kind === "build" && state.exitCode === 0 && !state.signal));
}
export async function stopOwnedChild(child, { spawn, platform = process.platform, timeoutMs = 10000 }) {
  if (child.exitCode !== null || child.signalCode !== null) throw new Error("부모가 먼저 종료되어 하위 작업 종료를 확인할 수 없습니다.");
  if (!Number.isInteger(child.pid) || child.pid <= 0) throw new Error("검사 프로세스 번호 확인 실패");
  let timer;
  try {
    await Promise.race([
      (async () => {
        const exited = waitForChild(child);
        if (platform === "win32") {
          const killer = spawn("taskkill.exe", ["/PID", String(child.pid), "/T", "/F"], { windowsHide: true, stdio: "ignore" });
          if (await waitForChild(killer) !== 0) throw new Error("검사 하위 프로세스 종료 확인 실패");
        } else if (!child.kill("SIGTERM")) throw new Error("검사 프로세스 종료 실패");
        await exited;
      })(),
      new Promise((resolve, reject) => { timer = setTimeout(() => reject(new Error("검사 종료 확인 시간 초과: 기존 빌드 보관 위치 유지")), timeoutMs); }),
    ]);
  } finally { clearTimeout(timer); }
}
if (process.env.LOCAL_ADMIN_BASELINE) {
  assertLocalBaselineEnvironment(process.env, path.resolve(process.cwd()));
  const originalFetch = globalThis.fetch;
  globalThis.fetch = guardedFetch(originalFetch);
}
