import fs from "node:fs";
import http from "node:http";
import { build } from "esbuild";
import { chromium, expect } from "@playwright/test";

// Real preparation/prefetch/IndexedDB modules. Only the HTTP response is a fixture.
async function main() {
const bundle = (await build({ stdin: { resolveDir: process.cwd(), loader: "ts", contents: `
import { localFixture, localId } from './src/features/quiz-player/test-support/local-quiz-fixtures';
import { packLocalQuizContents } from './src/features/quiz-player/domain/local-quiz-content';
import { commonContentKey } from './src/features/quiz-player/domain/local-quiz';
import { prepareLocalQuiz, prefetchLocalQuiz } from './src/features/quiz-player/client/flows/local-quiz-preparation';
import * as store from './src/features/quiz-player/client/flows/local-quiz-store';
window.verifyReuse = async () => {
  const {run, contents, plan} = await localFixture(3);
  localStorage.setItem('student-private-cache-identity', run.identity);
  const values = [...contents.values()], keys = [...contents.keys()];
  const packet = await packLocalQuizContents(values);
  let release, requested;
  const gate = new Promise(resolve => {release = resolve;});
  const started = new Promise(resolve => {requested = resolve;});
  const commands = []; let hoverSignal, preparationPacket;
  window.fetch = async (url, init) => {
    if (url !== '/api/student/local-quiz') throw Error('unexpected URL');
    const command = JSON.parse(init.body); commands.push(command);
    if (command.action === 'prefetch') {
      hoverSignal = init.signal; requested(); await gate;
      init.signal.throwIfAborted();
      return Response.json({...packet, requiredKeys:keys});
    }
    if (command.action !== 'prepare') throw Error('unexpected action');
    preparationPacket = await packLocalQuizContents(values, command.knownKeys);
    return Response.json({...run.preparation, packet:preparationPacket});
  };
  const hover = new AbortController(), first = new AbortController(), second = new AbortController();
  const prefetched = prefetchLocalQuiz(run.preparation.assignmentId, hover.signal).catch(e => e.name);
  await started;
  const cancelled = prepareLocalQuiz(run.preparation.assignmentId, first.signal).catch(e => e.name);
  const kept = prepareLocalQuiz(run.preparation.assignmentId, second.signal);
  hover.abort(); first.abort();
  const sharedTransportAlive = !hoverSignal.aborted;
  release();
  const href = await kept, cancelledName = await cancelled;
  await prefetched;
  const firstCommands = commands.map(c => c.action);
  const contentReused = keys.every(key => commands[1].knownKeys.includes(key));
  const bodyCount = preparationPacket.contents.length, atomCount = preparationPacket.atoms.length;
  const saved = await store.getLocalQuizRun(run.key);
  const answers = [{id:plan.items[0].id, choiceIndex:0, openedMs:0, answeredMs:200}];
  await store.saveLocalQuizRun({...saved, revision:saved.revision+1, plan, answers}, saved.revision);
  await prepareLocalQuiz(run.preparation.assignmentId);
  const after = await store.getLocalQuizRun(run.key);

  // Boundary regression: an older requested key must not disappear behind the
  // general inventory's newest 500 entries. This is not a load/capacity test.
  const at = Date.now();
  await store.cacheLocalQuizContents(packet, at-1000);
  const other = [];
  for (let i=0;i<500;i++) {
    const body = {...values[0].body, contentId:localId(1000+i)};
    other.push({key:await commonContentKey(body),body});
  }
  await store.cacheLocalQuizContents(await packLocalQuizContents(other), at);
  const inventoryExcluded = !(await store.knownLocalQuizContentKeys(at)).includes(keys[0]);
  const originalGetAll = IDBObjectStore.prototype.getAll; let scans = 0;
  IDBObjectStore.prototype.getAll = function(...args){scans++;return originalGetAll.apply(this,args);};
  let direct, directRun;
  try { direct = await store.knownLocalQuizKeysFor([keys[0]],at); directRun = await store.findLocalQuizRun(run.key,run.studentId); }
  finally { IDBObjectStore.prototype.getAll = originalGetAll; }
  const expired = await store.knownLocalQuizKeysFor([keys[0]],at+172800000);
  const db = await new Promise((resolve,reject) => {const q=indexedDB.open('english-academy-local-quiz-v1');q.onsuccess=()=>resolve(q.result);q.onerror=()=>reject(q.error);});
  await new Promise((resolve,reject)=>{const tx=db.transaction('atoms','readwrite');tx.objectStore('atoms').delete(packet.contents[0].prompt);tx.oncomplete=resolve;tx.onabort=()=>reject(tx.error);});
  db.close();
  const corrupt = await store.knownLocalQuizKeysFor([keys[0]],at);
  return {firstCommands,sharedTransportAlive,cancelledName,href,contentReused,bodyCount,atomCount,
    answersPreserved:JSON.stringify(after.answers)===JSON.stringify(answers),revisionPreserved:after.revision===saved.revision+1,
    inventoryExcluded,directFound:direct.includes(keys[0]),directRunFound:directRun.key===run.key,fullStoreScans:scans,
    expiredExcluded:!expired.includes(keys[0]),incompleteExcluded:!corrupt.includes(keys[0])};
};
` }, bundle: true, write: false, format: "iife", platform: "browser", define: { "process.env.NODE_ENV": '"production"', "process.env": "{}" },
plugins: [{ name: "nonvisual-css", setup(builder) { builder.onLoad({ filter: /\.module\.css$/ }, () => ({ contents: "export default {};", loader: "js" })); } }] })).outputFiles[0].text;
const server = http.createServer((_request, response) => {
  response.setHeader("Content-Type", "text/html; charset=utf-8");
  response.end("<!doctype html><title>가짜 자료 준비 검사</title>");
});
await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
const address = server.address();
if (!address || typeof address === "string") throw Error("Local test server unavailable");
const browser = await chromium.launch({ headless: true });
try {
  const page = await browser.newPage();
  page.on("pageerror", error => console.error(error.message));
  await page.goto(`http://127.0.0.1:${address.port}`);
  await page.addScriptTag({ content: bundle });
  const result = await page.evaluate(() => (window as unknown as { verifyReuse(): Promise<Record<string, unknown>> }).verifyReuse());
  expect(result).toEqual({ firstCommands: ["prefetch", "prepare"], sharedTransportAlive: true, cancelledName: "AbortError",
    href: "/quiz-offline#a5050000-0000-4000-8000-000000000002", contentReused: true, bodyCount: 0, atomCount: 0,
    answersPreserved: true, revisionPreserved: true, inventoryExcluded: true, directFound: true, directRunFound: true,
    fullStoreScans: 0, expiredExcluded: true, incompleteExcluded: true });
  fs.mkdirSync("docs/verification", { recursive: true });
  fs.writeFileSync("docs/verification/APP-20261008-03_실제캐시검사.json", JSON.stringify({ at: new Date().toISOString(), browser: browser.version(),
    scope: "실제 준비/미리받기/IndexedDB 코드, HTTP만 가짜 응답. 운영 인증 화면 검사를 대신하지 않음.", result }, null, 2));
  console.log(JSON.stringify(result));
} finally { await browser.close(); await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve())); }
}
void main().catch(error => { console.error(error); process.exitCode = 1; });
