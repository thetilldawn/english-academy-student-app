// Reusable local-only baseline. It does not add an application route or bypass application authentication.
import fs from "node:fs";
import path from "node:path";
import http from "node:http";
import { spawn } from "node:child_process";
import { Transform } from "node:stream";
import { fileURLToPath, pathToFileURL } from "node:url";
import { APP_ORIGIN, DATA_ORIGIN, NEXT_ORIGIN, PUBLIC_KEY, ACCOUNT, fixtureResponse } from "./local-admin-baseline-data.mjs";
import { STUDY_TOKEN } from "./local-student-study-data.mjs";
import { isLocalQuizRequest, localQuizSummary, localQuizWave, resetLocalQuizzes } from "./local-quiz-feedback-data.mjs";
import { assertLocalBaselineEnvironment, assertNestedPath, waitForChild, stopOwnedChild, assertMayStart, isRestorationSafe } from "./local-admin-baseline-guard.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const quizFeedback = process.argv.includes("--quiz-feedback");
const env = Object.fromEntries(["Path", "PATH", "SystemRoot", "SYSTEMROOT", "TEMP", "TMP", "USERPROFILE", "LOCALAPPDATA", "APPDATA"]
  .filter(key => process.env[key]).map(key => [key, process.env[key]]));
if (process.env.VERCEL || process.env.VERCEL_ENV || process.env.CI) throw new Error("배포/CI 환경에서는 시작하지 않습니다.");
Object.assign(env, {
  LOCAL_ADMIN_BASELINE: "fake-read-only-v1", APP_ORIGIN,
  STUDENT_DIRECTORY_CACHE_CANARY: process.argv.includes("--cache-canary") ? "1" : "0",
  ASSIGNMENT_DIRECTORY_CACHE_CANARY: process.argv.includes("--assignment-cache") ? "1" : "0",
  HISTORY_LIST_CACHE_CANARY: process.argv.includes("--history-cache") ? "1" : "0",
  NEXT_PUBLIC_SUPABASE_URL: DATA_ORIGIN, NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: PUBLIC_KEY,
  SUPABASE_SECRET_KEY: "local-server-placeholder-not-a-real-key", NEXT_TELEMETRY_DISABLED: "1",
  STUDENT_CODE_PEPPER: Buffer.alloc(32, 1).toString("base64"),
  STUDENT_SESSION_PEPPER: Buffer.alloc(32, 2).toString("base64"),
  STUDENT_CODE_ENCRYPTION_KEY: Buffer.alloc(32, 3).toString("base64"),
  LOGIN_IP_PEPPER: Buffer.alloc(32, 4).toString("base64"),
});
assertLocalBaselineEnvironment(env, root);
const guard = path.join(root, "scripts/local-admin-baseline-guard.mjs");
const nextCli = path.join(root, "node_modules/next/dist/bin/next");
const upstream = new URL(NEXT_ORIGIN);
const metrics = { http: [], data: [], ui: [] };
const audioMetrics = [];
const children = new Map();
let stopRequested = false;
const generatedDirectory = path.join(root, ".next");
const priorDirectory = path.join(root, ".codex-tmp", "before-local-admin-baseline-next");
const resultDirectory = path.join(root, ".codex-tmp", "local-admin-baseline-next-" + Date.now());
let buildMoved = false;
function preserveBuildDirectory() {
  for (const target of [generatedDirectory, priorDirectory, resultDirectory]) {
    const relative = path.relative(root, path.resolve(target));
    if (!relative || relative.startsWith("..") || path.isAbsolute(relative) ||
        (fs.existsSync(target) && fs.lstatSync(target).isSymbolicLink())) throw new Error("빌드 경로 확인 실패");
  }
  if (fs.existsSync(priorDirectory) || fs.existsSync(resultDirectory)) {
    throw new Error("이전 검사 빌드가 남아 있습니다. 덮어쓰지 않고 먼저 확인해 주세요.");
  }
  fs.mkdirSync(path.dirname(priorDirectory), { recursive: true });
  assertNestedPath(fs.realpathSync(root), fs.realpathSync(path.dirname(priorDirectory)));
  if (fs.existsSync(generatedDirectory)) fs.renameSync(generatedDirectory, priorDirectory);
  buildMoved = true;
}
function restoreBuildDirectory() {
  if (!buildMoved) return;
  for (const target of [generatedDirectory, priorDirectory, resultDirectory]) {
    assertNestedPath(fs.realpathSync(root), fs.realpathSync(path.dirname(target)) === fs.realpathSync(root)
      ? path.join(fs.realpathSync(root), path.basename(target)) : fs.realpathSync(path.dirname(target)));
    if (fs.existsSync(target) && fs.lstatSync(target).isSymbolicLink()) throw new Error("검사 빌드 경로 변경 감지");
  }
  if (fs.existsSync(generatedDirectory)) fs.renameSync(generatedDirectory, resultDirectory);
  if (fs.existsSync(priorDirectory)) fs.renameSync(priorDirectory, generatedDirectory);
  buildMoved = false;
}
const json = (res, value, status = 200) => {
  res.writeHead(status, { "Content-Type": "application/json", "Cache-Control": "no-store" });
  res.end(JSON.stringify(value));
};
async function readBody(req) {
  const parts = []; let size = 0;
  for await (const chunk of req) { size += chunk.length; if (size > 65536) throw new Error("Request too large"); parts.push(chunk); }
  return Buffer.concat(parts).toString("utf8");
}
const dataServer = http.createServer(async (req, res) => {
  if (req.headers.host !== new URL(DATA_ORIGIN).host) return json(res, { error: "Local host required" }, 403);
  try {
    const result = fixtureResponse({ url: DATA_ORIGIN + req.url, method: req.method,
      headers: new Headers(req.headers), body: await readBody(req), quizFeedback });
    metrics.data.push({ path: new URL(DATA_ORIGIN + req.url).pathname, method: req.method,
      category: result.category, status: result.status, at: Date.now() });
    json(res, result.body, result.status);
  } catch { json(res, { error: "Local fixture request rejected" }, 403); }
});
const allowedApi = new Set(["/api/admin/session", "/api/admin/students/directory",
  "/api/admin/history",
  "/api/admin/assignment-workspace/preparation", "/api/admin/assignment-workspace/datasets",
  "/api/admin/assignment-workspace/previous-exam", "/api/admin/assignment-workspace/selection"]);
const proxy = http.createServer(async (req, res) => {
  if (req.headers.host !== new URL(APP_ORIGIN).host) return json(res, { error: "Local host required" }, 403);
  const url = new URL(req.url, APP_ORIGIN);
  if (url.pathname === "/__baseline/student" && req.method === "GET") {
    // The real app still validates this token against the isolated fixture backend.
    res.writeHead(303, { location: "/student", "cache-control": "no-store",
      "set-cookie": "__Host-ea_student_session=" + STUDY_TOKEN + "; Path=/; HttpOnly; SameSite=Lax; Secure" });
    return res.end();
  }
  if (url.pathname === "/__baseline/metrics" && req.method === "GET") return json(res,
    quizFeedback ? { ...metrics, audio: audioMetrics, quizzes: localQuizSummary() } : metrics);
  if (quizFeedback && url.pathname === "/__baseline/quiz-observer.js" && req.method === "GET") {
    res.writeHead(200, { "Content-Type": "text/javascript", "Cache-Control": "no-store" });
    return res.end(fs.readFileSync(path.join(root, "scripts/local-quiz-feedback-observer.js")));
  }
  if (quizFeedback && url.pathname === "/__baseline/quiz-audio.wav" && req.method === "GET") {
    const wave = localQuizWave();
    res.writeHead(200, { "Content-Type": "audio/wav", "Content-Length": wave.length, "Cache-Control": "no-store" });
    return res.end(wave);
  }
  if (quizFeedback && url.pathname === "/__baseline/quiz-observe" && req.method === "POST") {
    if (req.headers.origin !== APP_ORIGIN) return json(res, {}, 403);
    try {
      const value = JSON.parse(await readBody(req));
      if (!["playing", "pause", "ended", "error"].includes(value.kind) ||
        !Number.isInteger(value.id) || value.id < 1 || !Number.isFinite(value.at) ||
        !Number.isFinite(value.currentTime) || value.currentTime < 0 ||
        typeof value.paused !== "boolean" || typeof value.muted !== "boolean") return json(res, {}, 403);
      audioMetrics.push({ kind: value.kind, id: value.id, at: value.at, currentTime: value.currentTime, paused: value.paused, muted: value.muted });
      return json(res, { ok: true });
    } catch { return json(res, {}, 403); }
  }
  if (url.pathname === "/__baseline/observer.js" && req.method === "GET") {
    res.writeHead(200, { "Content-Type": "text/javascript", "Cache-Control": "no-store" });
    return res.end(fs.readFileSync(path.join(root, "scripts/local-admin-baseline-observer.js")));
  }
  if (["/__baseline/observe", "/__baseline/stop"].includes(url.pathname) && req.method === "POST") {
    if (req.headers.origin !== APP_ORIGIN) return json(res, {}, 403);
    if (url.pathname.endsWith("/stop")) { json(res, { ok: true }); stopSafely(); return; }
    try {
      const value = JSON.parse(await readBody(req));
      if (!["initial", "link", "history", "filter", "modal-open", "modal-close"].includes(value.kind) ||
          !["/admin/students", "/admin/assignments", "/admin/results"].includes(value.route) ||
          !Number.isFinite(value.durationMs) || value.durationMs < 0 || !Number.isFinite(value.at)) return json(res, {}, 403);
      metrics.ui.push({ kind: value.kind, route: value.route, durationMs: value.durationMs, at: value.at });
      return json(res, { ok: true });
    } catch { return json(res, {}, 403); }
  }
  if (url.pathname === "/__baseline/reset" && req.method === "POST") {
    if (req.headers.origin !== APP_ORIGIN) return json(res, {}, 403);
    metrics.http.length = 0; metrics.data.length = 0; metrics.ui.length = 0;
    if (quizFeedback) { audioMetrics.length = 0; resetLocalQuizzes(); }
    return json(res, { ok: true });
  }
  if (url.pathname === "/api/admin/notifications") return json(res, { error: "Notifications excluded from local read baseline" }, 403);
  if (url.pathname.startsWith("/api/") && (!allowedApi.has(url.pathname) &&
      !(quizFeedback && isLocalQuizRequest(url.pathname, req.method)) &&
      !/^\/api\/admin\/assignment-workspace\/datasets\/00000000-0000-4000-8000-00000000001[01]\/units$/.test(url.pathname))) {
    return json(res, { error: "Application writes and unknown APIs are blocked" }, 403);
  }
  if (!["GET", "HEAD", "POST", "DELETE"].includes(req.method) ||
      (req.method !== "GET" && req.method !== "HEAD" && !url.pathname.startsWith("/api/")) ||
      (req.method === "DELETE" && url.pathname !== "/api/admin/session")) {
    return json(res, { error: "Unsupported local request" }, 403);
  }
  const started = performance.now();
  const forward = http.request({ hostname: upstream.hostname, port: upstream.port,
    method: req.method, path: req.url, headers: { ...req.headers, host: new URL(APP_ORIGIN).host, "accept-encoding": "identity" } }, response => {
    const isHtml = response.headers["content-type"]?.includes("text/html");
    const headers = { ...response.headers };
    if (isHtml) delete headers["content-length"];
    res.writeHead(response.statusCode, {
      ...headers,
      "content-security-policy": "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; font-src 'self' data:; img-src 'self' data:; connect-src 'self'; form-action 'self'; frame-src 'none'; base-uri 'self'",
    });
    let bytes = 0;
    response.on("data", chunk => { bytes += chunk.length; });
    response.on("end", () => metrics.http.push({ path: url.pathname, method: req.method,
      rsc: req.headers.rsc === "1", prefetch: req.headers["next-router-prefetch"] === "1",
      status: response.statusCode, bytes, durationMs: performance.now() - started, at: Date.now() }));
    if (isHtml) {
      let injected = false, prefix = Buffer.alloc(0);
      response.pipe(new Transform({ transform(chunk, encoding, callback) {
        if (injected) return callback(null, chunk);
        prefix = Buffer.concat([prefix, chunk]);
        const headAt = prefix.indexOf(Buffer.from("<head>"));
        if (headAt < 0) return prefix.length > 16384 ? callback(new Error("Expected initial HTML head")) : callback();
        injected = true;
        callback(null, Buffer.concat([prefix.subarray(0, headAt + 6),
          Buffer.from((quizFeedback ? '<script src="/__baseline/quiz-observer.js"></script>' : '') +
            '<script src="/__baseline/observer.js" defer></script>'), prefix.subarray(headAt + 6)]));
      } })).on("error", () => res.destroy()).pipe(res);
    } else response.pipe(res);
  });
  forward.on("error", () => { if (!res.headersSent) json(res, { error: "Local app not ready" }, 503); else res.end(); });
  req.on("aborted", () => forward.destroy());
  req.pipe(forward);
});
const listen = (server, port) => new Promise((resolve, reject) => {
  server.once("error", reject); server.listen(port, "127.0.0.1", resolve);
});
function runNext(args) {
  assertMayStart(stopRequested);
  const child = spawn(process.execPath, ["--import", pathToFileURL(guard).href, nextCli, ...args], {
    cwd: root, env, stdio: "inherit", windowsHide: true,
  });
  const state = { kind: args[0], exitCode: null, signal: null, treeStopped: false, spawnFailed: false };
  children.set(child, state);
  child.on("exit", (code, signal) => { state.exitCode = code; state.signal = signal; });
  child.on("error", () => { state.spawnFailed = !child.pid; });
  return child;
}
let stopPromise;
function stop() {
  stopRequested = true;
  return stopPromise ??= (async () => {
    await Promise.all([...children].map(async ([child, state]) => {
      if (isRestorationSafe([state])) return;
      await stopOwnedChild(child, { spawn });
      state.treeStopped = true;
    }));
    if (!isRestorationSafe([...children.values()])) throw new Error("하위 작업 종료 미확인: 기존 빌드 보관 위치 유지");
    await Promise.all([proxy, dataServer].map(server => new Promise(resolve => {
      server.close(resolve); server.closeAllConnections();
    })));
    restoreBuildDirectory();
  })();
}
const stopSafely = () => { void stop().catch(error => { console.error(error.message); process.exitCode = 1; }); };
process.on("SIGINT", stopSafely);
process.on("SIGTERM", stopSafely);
try {
  await listen(dataServer, 3038);
  assertMayStart(stopRequested);
  preserveBuildDirectory();
  // Fresh build is mandatory: never reuse NEXT_PUBLIC values from an older build.
  const build = runNext(["build"]);
  const buildCode = await waitForChild(build);
  assertMayStart(stopRequested);
  if (buildCode !== 0) throw new Error("격리된 로컬 빌드 실패");
  if (!fs.existsSync(path.join(root, ".next/BUILD_ID"))) throw new Error("빌드 결과 없음");
  const next = runNext(["start", "--hostname", "127.0.0.1", "--port", "3040"]);
  next.once("exit", stopSafely);
  next.once("error", stopSafely);
  await listen(proxy, 3037);
  assertMayStart(stopRequested);
  console.log(JSON.stringify({ url: APP_ORIGIN + "/admin/login", account: ACCOUNT,
    note: "가짜 로그인/읽기 전용. 실제 인증·DB 비용 검증 아님. 등록/배정/수정/삭제 금지." }));
} catch (error) { await stop(); throw error; }
