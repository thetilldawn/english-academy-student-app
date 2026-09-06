// Local-only verification surface. No Next route, credentials, DB, or remote requests.
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createServer } from "vite";

if (process.env.VERCEL) throw new Error("로컬 검사 화면은 배포 환경에서 실행할 수 없습니다.");
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const entry = "/__history-fixture.jsx";
const fixtureSource = `
import React, { useState } from "react";
import { createRoot } from "react-dom/client";
import { AdminHistoryList } from "@/features/history/ui/admin-history-list";
import "pretendard/dist/web/variable/pretendardvariable.css";
import "@/styles/tokens.css";
import "@/styles/theme.css";
import "@/styles/reset.css";

let reply = "error";
let calls = 0;
const stamp = "2026-09-06T00:00:00.000Z";
const item = (id) => ({
  activityAt: stamp, assignedAt: stamp, assignmentId: "00000000-0000-4000-8000-000000000001",
  assignmentPurpose: "regular", assignmentTitle: "로컬 검사 시험 " + id, attemptId: null,
  availableUntil: null, cancelledAt: null, completedAt: null, datasetTitle: "가짜 자료",
  deadlineAt: null, finalScore: null, id, initialCompletedAt: null, initialScore: null, missedAt: null,
  passed: null, passingScore: 80, phase: null, primaryUnitLabels: [], questionCount: 20,
  retryStartedAt: null, startedAt: null, status: "not_started",
  studentId: "00000000-0000-4000-8000-000000000002", studentName: "로컬 검사 학생", unitLabels: []
});
const makeSnapshot = (filled, request = {}) => ({
  currentOnly: false, query: request.query ?? "", statusFilter: request.statusFilter ?? "all",
  snapshotAt: new Date().toISOString(),
  sections: (!request.statusFilter || request.statusFilter === "all"
    ? ["open", "needs_attention", "completed", "archived"] : ["filter-" + request.statusFilter]
  ).map((groupKey, index) => ({
    groupKey,
    items: filled && index === 0 ? [item("first")] : [],
    nextCursor: filled && index === 0 ? "fake-cursor" : null,
    totalCount: filled && index === 0 ? 2 : 0
  }))
});
window.fetch = async (input, init) => {
  if (input !== "/api/admin/history") throw new Error("외부 요청 금지");
  const request = JSON.parse(init.body);
  const currentReply = reply;
  calls++;
  document.getElementById("read-count").textContent = "가짜 읽기 요청 " + calls + "회";
  await new Promise((resolve, reject) => {
    const timer = window.setTimeout(resolve, currentReply === "slow" ? 2000 : 250);
    const abort = () => {
      window.clearTimeout(timer);
      reject(new DOMException("cancelled", "AbortError"));
    };
    if (init.signal?.aborted) abort();
    else init.signal?.addEventListener("abort", abort, { once: true });
  });
  if (currentReply === "auth") return Response.json({ error: "private failure" }, { status: 401 });
  if (currentReply === "error") return Response.json({ error: "private SQL failure" }, { status: 503 });
  if (request.mode === "page") return Response.json({ page: { items: [item("second")], nextCursor: null } });
  if (request.mode === "section") return Response.json({ section: {
    groupKey: request.groupKey, items: [], nextCursor: null, totalCount: 0, version: request.snapshotAt
  } });
  return Response.json({ snapshot: makeSnapshot(currentReply !== "empty", request) });
};
function Fixture() {
  const [initial, setInitial] = useState(() => makeSnapshot(false));
  const [mode, setMode] = useState(reply);
  const reset = (filled) => setInitial(makeSnapshot(filled));
  return (
    <main style={{ maxWidth: 880, margin: "auto", padding: 24 }}>
      <h1>내역 조회 — 로컬 가짜 자료 검사</h1>
      <p>실제 계정·DB·외부 요청 없음. 목록·안내는 실제 수정 부품이며 행 내용과 링크만 격리합니다.</p>
      <fieldset style={{ display: "flex", flexWrap: "wrap", gap: 12, margin: "24px 0", padding: 12 }}>
        <legend>검사 조건</legend>
        <label>다음 응답 <select value={mode} onChange={(event) => { reply = event.target.value; setMode(reply); }}>
          <option value="error">조회 실패</option><option value="empty">성공 0건</option>
          <option value="ok">성공 1건</option><option value="slow">느린 성공</option><option value="auth">로그인 실패</option>
        </select></label>
        <button onClick={() => reset(false)}>초기 0건</button>
        <button onClick={() => reset(true)}>초기 1건</button>
        <button onClick={() => window.dispatchEvent(new CustomEvent("admin-history:mutated", { detail: {
          before: item("first"), after: null,
          receipt: { kind: "hidden", assignmentId: item("first").assignmentId,
            attemptId: "00000000-0000-4000-8000-000000000003", studentId: item("first").studentId,
            version: new Date().toISOString() }
        } }))}>구역 갱신</button>
      </fieldset>
      <p id="read-count">가짜 읽기 요청 0회</p>
      <AdminHistoryList key={initial.snapshotAt} initialSnapshot={initial} showFilters />
    </main>
  );
}
createRoot(document.getElementById("root")).render(<Fixture />);
`;
const rowSource = `import React from "react";
export function HistoryRows({items}) { return <ol>{items.map((item) =>
  <li key={item.id} style={{padding: 16, border: "1px solid currentColor"}}>
    {item.studentName} · {item.assignmentTitle}
  </li>)}</ol>; }`;
const linkSource = `import React from "react";
export default function Link({href, children, prefetch, replace, scroll, ...props}) {
  return <a href={typeof href === "string" ? href : "/"} {...props}>{children}</a>;
}`;

const server = await createServer({
  root, configFile: false, envDir: false, logLevel: "warn",
  server: { host: "127.0.0.1", port: 3036, strictPort: true },
  oxc: { jsx: { runtime: "automatic" } },
  optimizeDeps: { noDiscovery: true, include: ["react", "react-dom/client", "react/jsx-runtime", "react/jsx-dev-runtime", "zod"] },
  resolve: { alias: { "@": path.join(root, "src") } },
  plugins: [{
    name: "isolated-history-read-fixture", enforce: "pre",
    resolveId(source, importer) {
      if (source === entry) return entry;
      if (source === "next/link") return "/__fixture-link.jsx";
      if (source === "./history-rows" && importer?.replaceAll("\\", "/").includes("/features/history/ui/")) return "/__fixture-rows.jsx";
    },
    load(id) {
      if (id === entry) return fixtureSource;
      if (id === "/__fixture-link.jsx") return linkSource;
      if (id === "/__fixture-rows.jsx") return rowSource;
    },
    configureServer(vite) {
      vite.middlewares.use((request, response, next) => {
        if (request.url?.startsWith("/api/")) {
          response.statusCode = 403;
          response.end("검사 화면은 실제 API를 사용하지 않습니다.");
          return;
        }
        if (request.url === "/" || request.url === "/admin/login") {
          response.setHeader("content-type", "text/html; charset=utf-8");
          response.end('<!doctype html><html lang="ko" data-theme="dark"><head><meta name="viewport" content="width=device-width,initial-scale=1"><title>내역 로컬 검사</title></head><body><div id="root"></div><script type="module" src="' + entry + '"></script></body></html>');
          return;
        }
        next();
      });
    },
  }],
});
await server.listen();
console.log("격리된 내역 검사: http://127.0.0.1:3036/ (가짜 자료, 외부 요청 없음)");
for (const signal of ["SIGINT", "SIGTERM"]) {
  process.once(signal, async () => { await server.close(); process.exit(0); });
}
