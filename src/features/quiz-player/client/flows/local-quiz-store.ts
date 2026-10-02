import { COMMON_QUIZ_FRESH_MS, commonQuizPacketSchema, type CommonQuizContent, type CommonQuizPacket, type CommonQuizReference, type LocalQuizRun } from "../../contracts/local-quiz";
import { makeDisplayAtom, type DisplayAtom } from "@/lib/quiz/shared-display";
import { localContentAtomKeys, unpackLocalQuizContent } from "../../domain/local-quiz-content";

const NAME = "english-academy-local-quiz-v1";
const TABLES = ["contents", "atoms", "runs", "meta"] as const;
type Table = typeof TABLES[number];
type StoredContent = CommonQuizReference & { cachedAt: number };
type StoredAtom = DisplayAtom & { cachedAt: number };
let opened: Promise<IDBDatabase> | null = null;
function database() {
  if (opened) return opened;
  opened = new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open(NAME, 1);
    request.onupgradeneeded = () => { for (const name of TABLES) request.result.createObjectStore(name, { keyPath: "key" }); };
    request.onerror = () => reject(request.error ?? new Error("local_storage_unavailable"));
    request.onblocked = () => reject(new Error("local_storage_blocked"));
    request.onsuccess = () => { request.result.onversionchange = () => { request.result.close(); opened = null; }; resolve(request.result); };
  }).catch(error => { opened = null; throw error; });
  return opened;
}
/** Resolution means transaction COMMIT, never merely a successful put request. */
async function transaction<T>(tables: Table[], mode: IDBTransactionMode, act: (tx: IDBTransaction, finish: (value: T) => void) => void): Promise<T> {
  const db = await database();
  return new Promise<T>((resolve, reject) => {
    const tx = db.transaction(tables, mode, mode === "readwrite" ? { durability: "strict" } : undefined);
    let value: T; let failure: unknown;
    tx.oncomplete = () => resolve(value);
    tx.onabort = () => reject(failure ?? tx.error ?? new Error("local_storage_aborted"));
    tx.onerror = () => { failure ??= tx.error; };
    try { act(tx, result => { value = result; }); } catch (error) { failure = error; tx.abort(); }
  });
}
function read<T>(table: Table, key: string) {
  return transaction<T | undefined>([table], "readonly", (tx, finish) => {
    const q = tx.objectStore(table).get(key); q.onsuccess = () => finish(q.result as T | undefined);
  });
}
function all<T>(table: Table) {
  return transaction<T[]>([table], "readonly", (tx, finish) => { const q = tx.objectStore(table).getAll(); q.onsuccess = () => finish(q.result as T[]); });
}
export async function getLocalQuizDevice() {
  return transaction<string>(["meta"], "readwrite", (tx, finish) => {
    const store = tx.objectStore("meta"); const request = store.get("device");
    request.onsuccess = () => {
      const value = request.result?.value ?? Array.from(crypto.getRandomValues(new Uint8Array(32)), b => b.toString(16).padStart(2, "0")).join("");
      store.put({ key: "device", value }); finish(value);
    };
  });
}
export async function cacheLocalQuizContents(packet: CommonQuizPacket, now = Date.now()) {
  commonQuizPacketSchema.parse(packet);
  for (const atom of packet.atoms) if ((await makeDisplayAtom(atom.value)).key !== atom.key) throw new Error("local_content_corrupted");
  await transaction<void>(["contents", "atoms"], "readwrite", tx => {
    for (const content of packet.contents) tx.objectStore("contents").put({ ...content, cachedAt: now });
    for (const atom of packet.atoms) tx.objectStore("atoms").put({ ...atom, cachedAt: now });
  });
}
export async function readLocalDisplayAtoms(keys: string[], pinned = false, now = Date.now()) {
  const rows = await transaction<Array<StoredAtom | undefined>>(["atoms"], "readonly", (tx, finish) => {
    const result: Array<StoredAtom | undefined> = new Array(keys.length); finish(result);
    keys.forEach((key, i) => { const q = tx.objectStore("atoms").get(key); q.onsuccess = () => { result[i] = q.result; }; });
  });
  const atoms = new Map<string, DisplayAtom>();
  for (const atom of rows) {
    if (!atom || !pinned && (now < atom.cachedAt || now - atom.cachedAt >= COMMON_QUIZ_FRESH_MS)) continue;
    try { if ((await makeDisplayAtom(atom.value)).key === atom.key) atoms.set(atom.key, atom); } catch { /* Refetch corrupt common data before starting. */ }
  }
  return atoms;
}
export async function readLocalQuizContents(keys: string[], pinned = false, now = Date.now()) {
  const result = new Map<string, CommonQuizContent>();
  const contents = await transaction<Array<StoredContent | undefined>>(["contents"], "readonly", (tx, finish) => {
    const rows: Array<StoredContent | undefined> = new Array(keys.length); finish(rows);
    keys.forEach((key, i) => { const request = tx.objectStore("contents").get(key); request.onsuccess = () => { rows[i] = request.result; }; });
  });
  const atoms = await readLocalDisplayAtoms([...new Set(contents.flatMap(c => c ? localContentAtomKeys(c) : []))], pinned, now);
  await Promise.all(contents.map(async content => {
    if (!content || !pinned && (now < content.cachedAt || now - content.cachedAt >= COMMON_QUIZ_FRESH_MS)) return;
    const parsed = await unpackLocalQuizContent(content, atoms);
    if (parsed) result.set(content.key, parsed);
  }));
  return result;
}
export async function knownLocalQuizContentKeys(now = Date.now()) {
  const contents = await all<StoredContent>("contents"); const atoms = await all<StoredAtom>("atoms");
  const candidates = contents.filter(c => now >= c.cachedAt && now - c.cachedAt < COMMON_QUIZ_FRESH_MS).sort((a, b) => b.cachedAt - a.cachedAt).slice(0, 500);
  const validContents = await readLocalQuizContents(candidates.map(c => c.key), false, now);
  const validAtoms = await readLocalDisplayAtoms(atoms.filter(a => now >= a.cachedAt && now - a.cachedAt < COMMON_QUIZ_FRESH_MS)
    .sort((a, b) => b.cachedAt - a.cachedAt).slice(0, 5000).map(a => a.key), false, now);
  return [...validContents.keys(), ...validAtoms.keys()];
}
export const getLocalQuizRun = (key: string) => read<LocalQuizRun>("runs", key);
export async function findLocalQuizRun(attemptId: string, studentId: string) {
  return (await all<LocalQuizRun>("runs")).find(run => run.studentId === studentId && (run.plan?.attemptId ?? run.preparation.preparationId) === attemptId);
}
export async function saveLocalQuizRun(run: LocalQuizRun, expectedRevision: number | null) {
  return transaction<void>(["runs"], "readwrite", tx => {
    const store = tx.objectStore("runs"); const request = store.get(run.key);
    request.onsuccess = () => {
      const prior = request.result as LocalQuizRun | undefined;
      if (expectedRevision === null ? Boolean(prior) : !prior || prior.revision !== expectedRevision || run.revision !== expectedRevision + 1) {
        tx.abort(); return;
      }
      store.put(run);
    };
  });
}
/** Evict only expired, unreferenced common material. Answers have no TTL/deletion path. */
export async function pruneLocalQuizContents(now = Date.now()) {
  await transaction<void>(["runs", "contents", "atoms"], "readwrite", tx => {
    const runs = tx.objectStore("runs").getAll(); const contents = tx.objectStore("contents").getAll(); const atoms = tx.objectStore("atoms").getAll();
    let count = 0;
    const ready = () => {
      if (++count !== 3) return;
      const pinned = new Set((runs.result as LocalQuizRun[]).filter(r => r.startRequested || (r.plan !== null || r.batch !== null) && !r.receipt?.result.finalized).flatMap(r => r.preparation.items.map(i => i.key)));
      const keepAtoms = new Set<string>();
      for (const item of contents.result as StoredContent[]) {
        if (pinned.has(item.key) || now - item.cachedAt < COMMON_QUIZ_FRESH_MS) localContentAtomKeys(item).forEach(k => keepAtoms.add(k));
        else tx.objectStore("contents").delete(item.key);
      }
      for (const atom of atoms.result as StoredAtom[]) {
        if (!keepAtoms.has(atom.key) && now - atom.cachedAt >= COMMON_QUIZ_FRESH_MS) tx.objectStore("atoms").delete(atom.key);
      }
    };
    runs.onsuccess = ready; contents.onsuccess = ready; atoms.onsuccess = ready;
  });
}
export async function holdLocalQuizTab(key: string) {
  if (!navigator.locks) throw new Error("local_tab_lock_unavailable");
  return new Promise<() => Promise<void>>((resolve, reject) => {
    const completed = navigator.locks.request(`local-quiz:${key}`, { ifAvailable: true }, lock => {
      if (!lock) { reject(new Error("local_quiz_another_tab")); return; }
      return new Promise<void>(release => resolve(async () => { release(); await completed; }));
    });
    completed.catch(reject);
  });
}
