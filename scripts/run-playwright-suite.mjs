import { createRequire } from "node:module";
import { once } from "node:events";
import { spawn, spawnSync } from "node:child_process";

const require = createRequire(import.meta.url);
const playwrightCli = require.resolve("@playwright/test/cli");
const nextCli = require.resolve("next/dist/bin/next");
const [suite, ...extraArguments] = process.argv.slice(2);
const [nodeMajor, nodeMinor] = process.versions.node.split(".").map(Number);
const listOnly = extraArguments.includes("--list");

if (nodeMajor !== 24 || nodeMinor < 13) {
  throw new Error(
    `Playwright 실행에는 Node.js 24.13 이상 25 미만이 필요합니다. 현재 ${process.versions.node}`,
  );
}

if (suite !== "smoke" && suite !== "authenticated") {
  throw new Error(
    "사용법: node scripts/run-playwright-suite.mjs smoke|authenticated [Playwright 옵션]",
  );
}

function readGitValue(arguments_) {
  const result = spawnSync(
    "git",
    ["-c", `safe.directory=${process.cwd()}`, ...arguments_],
    {
      cwd: process.cwd(),
      encoding: "utf8",
      windowsHide: true,
    },
  );
  if (result.status !== 0) {
    throw new Error(`Git 실행 실패: ${result.stderr?.trim() || arguments_.join(" ")}`);
  }
  return result.stdout.trim();
}

if (suite === "authenticated" && !listOnly) {
  const localSha = readGitValue(["rev-parse", "HEAD"]);
  const declaredRunnerSha = process.env.E2E_CHECK_RUNNER_SHA;
  if (declaredRunnerSha && declaredRunnerSha !== localSha) {
    throw new Error("검사 도구 SHA가 현재 checkout과 다릅니다.");
  }
  process.env.E2E_CHECK_RUNNER_SHA = localSha;

  if (!process.env.CI) {
    const localBranch = readGitValue(["branch", "--show-current"]);
    if (process.env.E2E_EXPECTED_GIT_REF !== localBranch) {
      throw new Error("로컬 브랜치가 승인한 Preview Git 브랜치와 다릅니다.");
    }
    if (process.env.E2E_TARGET_DEPLOYMENT_SHA !== localSha) {
      throw new Error("로컬 HEAD가 검사할 Preview 배포 SHA와 다릅니다.");
    }
  }
}

const runs = suite === "smoke"
  ? ["mobile", "tablet", "desktop"].map((viewport) => ({
      label: `public-${viewport}`,
      environment: { E2E_SUITE: "public", E2E_VIEWPORT: viewport },
    }))
  : [{
      label: "authenticated-preview",
      environment: { E2E_SUITE: "authenticated", E2E_VIEWPORT: "desktop" },
    }];

const localOrigin = `http://127.0.0.1:${process.env.PLAYWRIGHT_PORT ?? "3100"}`;

async function waitForServer(origin) {
  const deadline = Date.now() + 60_000;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(origin, { redirect: "manual" });
      if (response.status < 500) return;
    } catch {
      // The production server has not opened its socket yet.
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(`로컬 Next.js 서버가 60초 안에 시작되지 않았습니다: ${origin}`);
}

async function stopServer(server) {
  if (server.exitCode !== null) return;
  server.kill();
  await Promise.race([
    once(server, "exit"),
    new Promise((resolve) => setTimeout(resolve, 3_000)),
  ]);
  if (server.exitCode === null) server.kill("SIGKILL");
}

let localServer;
let exitCode = 0;
try {
  if (!process.env.PLAYWRIGHT_BASE_URL && !listOnly) {
    if (suite !== "smoke") {
      throw new Error("인증 E2E에는 PLAYWRIGHT_BASE_URL이 필요합니다.");
    }
    localServer = spawn(
      process.execPath,
      [
        nextCli,
        "start",
        "--hostname",
        "127.0.0.1",
        "--port",
        process.env.PLAYWRIGHT_PORT ?? "3100",
      ],
      { env: process.env, stdio: "ignore", windowsHide: true },
    );
    await waitForServer(localOrigin);
  }

  for (const run of runs) {
    console.log(`\n[E2E] ${run.label}`);
    const result = spawnSync(
      process.execPath,
      [playwrightCli, "test", ...extraArguments],
      {
        env: {
          ...process.env,
          ...run.environment,
          PLAYWRIGHT_BASE_URL: process.env.PLAYWRIGHT_BASE_URL ?? localOrigin,
        },
        stdio: "inherit",
      },
    );
    if (result.error) throw result.error;
    if (result.status !== 0) {
      exitCode = result.status ?? 1;
      break;
    }
  }
} finally {
  if (localServer) await stopServer(localServer);
}

process.exitCode = exitCode;
