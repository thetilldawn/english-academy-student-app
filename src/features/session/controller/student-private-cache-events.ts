type Change = "identity" | "mistakes";
const LOCAL_EVENT = "student-private-cache:change";
const CHANNEL = "student-private-cache-v1";
const STORAGE_KEY = "student-private-cache-signal";
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
