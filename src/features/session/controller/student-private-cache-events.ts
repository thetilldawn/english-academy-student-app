type Change = "identity" | "mistakes";
const LOCAL_EVENT = "student-private-cache:change";
const CHANNEL = "student-private-cache-v1";
const STORAGE_KEY = "student-private-cache-signal";
const IDENTITY_KEY = "student-private-cache-identity";
/** Persistent across closed tabs. Never contains a student identifier. */
export function studentIdentityGeneration() {
  let generation = localStorage.getItem(IDENTITY_KEY);
  if (!generation) { generation = crypto.randomUUID(); localStorage.setItem(IDENTITY_KEY, generation); }
  if (localStorage.getItem(IDENTITY_KEY) !== generation) throw new Error("identity_storage_unavailable");
  return generation;
}
type Signal = { kind: Change; nonce: string };
function valid(value: unknown): value is Signal {
  return typeof value === "object" && value !== null && "kind" in value
    && (value.kind === "identity" || value.kind === "mistakes")
    && "nonce" in value && typeof value.nonce === "string" && value.nonce.length <= 100;
}

/** No identity, word, answer or session value crosses tabs. */
export function announceStudentPrivateCacheChange(kind: Change) {
  if (typeof window === "undefined") return;
  const signal: Signal = { kind, nonce: crypto.randomUUID() };
  if (kind === "identity") {
    try { localStorage.setItem(IDENTITY_KEY, signal.nonce); } catch { /* Active offline screens still lock via the signal. */ }
  }
  window.dispatchEvent(new CustomEvent(LOCAL_EVENT, { detail: signal }));
  try {
    const channel = new BroadcastChannel(CHANNEL);
    channel.postMessage(signal); channel.close();
  } catch {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(signal)); localStorage.removeItem(STORAGE_KEY); } catch { /* Return still rechecks authorization. */ }
  }
}
export function subscribeStudentPrivateCacheChanges(listener: (kind: Change) => void) {
  const seen = new Set<string>();
  const receive = (value: unknown) => {
    if (!valid(value) || seen.has(value.nonce)) return;
    seen.add(value.nonce);
    if (seen.size > 128) seen.delete(seen.values().next().value!);
    listener(value.kind);
  };
  const local = (event: Event) => receive((event as CustomEvent).detail);
  const storage = (event: StorageEvent) => {
    if (event.key !== STORAGE_KEY || !event.newValue) return;
    try { receive(JSON.parse(event.newValue)); } catch { /* Ignore malformed signals. */ }
  };
  let channel: BroadcastChannel | undefined;
  try { channel = new BroadcastChannel(CHANNEL); channel.onmessage = event => receive(event.data); } catch { /* Storage fallback. */ }
  window.addEventListener(LOCAL_EVENT, local); window.addEventListener("storage", storage);
  return () => { channel?.close(); window.removeEventListener(LOCAL_EVENT, local); window.removeEventListener("storage", storage); };
}
