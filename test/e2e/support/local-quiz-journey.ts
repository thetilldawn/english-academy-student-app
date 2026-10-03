import { expect, type Page, type Request } from "@playwright/test";
import type { LocalQuizRun, LocalReceipt } from "../../../src/features/quiz-player/contracts/local-quiz";

// Observe only records made by the real app. Never seed or mutate IndexedDB here.
export async function readLocalRun(page: Page, explicitKey?: string): Promise<LocalQuizRun> {
  return page.evaluate(async (key) => {
    const localKey = key ?? location.hash.slice(1).split("/")[0];
    if (!/^[0-9a-f-]{36}$/.test(localKey)) throw Error("기기 시험 식별자가 없습니다.");
    if (!(await indexedDB.databases()).some(db => db.name === "english-academy-local-quiz-v1")) throw Error("앱이 만든 시험 저장소가 없습니다.");
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open("english-academy-local-quiz-v1", 1);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    try {
      return await new Promise<LocalQuizRun>((resolve, reject) => {
        const request = db.transaction("runs", "readonly").objectStore("runs").get(localKey);
        request.onsuccess = () => request.result ? resolve(request.result) : reject(Error("기기 시험이 없습니다."));
        request.onerror = () => reject(request.error);
      });
    } finally { db.close(); }
  }, explicitKey);
}

export function observeQuizRequests(page: Page) {
  const requests: Array<{ action: string; pathname: string }> = [];
  const listener = (request: Request) => {
    const pathname = new URL(request.url()).pathname;
    if (pathname === "/api/student/local-quiz") {
      requests.push({ pathname, action: request.postDataJSON()?.action ?? "unknown" });
    } else if (/^\/api\/student\/attempts\//.test(pathname)) requests.push({ pathname, action: request.method() });
  };
  page.on("request", listener);
  return { requests, stop: () => page.off("request", listener) };
}

export async function startLocalAssignment(page: Page, assignmentId: string) {
  await page.goto("/student");
  const card = page.locator(`article[data-assignment-id="${assignmentId}"]`);
  await expect(card).toHaveCount(1);
  const begin = page.waitForResponse(response => response.request().method() === "POST" &&
    new URL(response.url()).pathname === "/api/student/local-quiz" && response.request().postDataJSON()?.action === "begin");
  await card.getByRole("button", { name: "시험 시작", exact: true }).click();
  expect((await begin).status()).toBe(200);
  await page.waitForURL(/\/quiz-offline#[0-9a-f-]{36}$/);
  await expect(page.locator("#quiz-prompt")).toBeVisible();
  const run = await readLocalRun(page);
  expect(run.preparation.assignmentId).toBe(assignmentId);
  return run;
}

export async function chooseLocalAnswer(page: Page, correct: boolean) {
  const run = await readLocalRun(page);
  const item = run.plan?.items[run.answers.length];
  if (!item) throw Error("풀 문항이 없습니다.");
  const choice = correct ? item.correctChoiceIndex : (item.correctChoiceIndex + 1) % 4;
  const button = page.locator("button[data-feedback]").nth(choice);
  await expect(button).toBeEnabled();
  await button.focus();
  await button.press("Enter");
  await expect.poll(async () => (await readLocalRun(page)).answers.length).toBe(run.answers.length + 1);
  await expect.poll(() => page.evaluate(() => document.querySelector("#quiz-prompt")?.getAttribute("data-question-id") ?? null), { timeout: 15_000 }).not.toBe(item.id);
  return item.id;
}

export async function finishLocalPhase(page: Page, wrongIndexes: number[] = []) {
  const first = await readLocalRun(page);
  if (!first.plan) throw Error("회차 계획이 없습니다.");
  const network = observeQuizRequests(page);
  const submission = page.waitForResponse(response => response.request().method() === "POST" &&
    new URL(response.url()).pathname === "/api/student/local-quiz" && response.request().postDataJSON()?.action === "submit");
  for (let index = first.answers.length; index < first.plan.items.length; index += 1) {
    await chooseLocalAnswer(page, !wrongIndexes.includes(index));
    if (index < first.plan.items.length - 1) expect(network.requests).toHaveLength(0);
  }
  const response = await submission;
  expect(response.status()).toBe(200);
  const receipt = await response.json() as LocalReceipt;
  await expect(page.getByText("시험 결과가 저장됐습니다.", { exact: true })).toBeVisible();
  expect(network.requests.map(r => r.action)).toEqual(["submit"]);
  network.stop();
  return receipt;
}

export async function startLocalRetry(page: Page) {
  const response = page.waitForResponse(r => new URL(r.url()).pathname === "/api/student/local-quiz" && r.request().postDataJSON()?.action === "retry");
  await page.getByRole("button", { name: "재시험 시작", exact: true }).click();
  expect((await response).status()).toBe(200);
  await expect(page.locator("#quiz-prompt")).toBeVisible();
  expect((await readLocalRun(page)).plan?.phase).toBe("retry");
}

export async function activeScreenBuild(page: Page) {
  return page.evaluate(async () => {
    const registration = await navigator.serviceWorker.getRegistration("/quiz-offline");
    if (!registration?.active) return null;
    return new Promise<string | null>((resolve) => {
      const channel = new MessageChannel();
      const timer = setTimeout(() => { channel.port1.close(); resolve(null); }, 5000);
      channel.port1.onmessage = event => { clearTimeout(timer); channel.port1.close(); resolve(event.data?.ready ? event.data.build : null); };
      registration.active!.postMessage({ type: "LOCAL_QUIZ_READY" }, [channel.port2]);
    });
  });
}
