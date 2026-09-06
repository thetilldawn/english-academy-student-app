type Change = "identity" | "students";
const LOCAL_EVENT = "admin-private-cache:change";
const CHANNEL = "admin-private-cache-v1";
const STORAGE_KEY = "admin-private-cache-signal";
function valid(value: unknown): value is { kind: Change } {
  return typeof value === "object" && value !== null && "kind" in value && (value.kind === "identity" || value.kind === "students");
}

/** Only a change kind and random nonce leave this tab; never a user/student identifier. */
export function announceAdminPrivateCacheChange(kind: Change) {
  if (typeof window === "undefined") return;
  const signal = { kind, nonce: crypto.randomUUID() };
  window.dispatchEvent(new CustomEvent(LOCAL_EVENT, { detail: signal }));
  try {
    const channel = new BroadcastChannel(CHANNEL);
    channel.postMessage(signal); channel.close();
  } catch {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(signal)); localStorage.removeItem(STORAGE_KEY); } catch { /* Return/visibility still requires a fresh server authorization. */ }
  }
}
export function subscribeAdminPrivateCacheChanges(listener: (kind: Change, remote: boolean) => void) {
  const seen = new Set<string>();
  const receive = (value: unknown, remote: boolean) => {
    if (!valid(value)) return;
    if ("nonce" in value && typeof value.nonce === "string") {
      if (seen.has(value.nonce)) return;
      seen.add(value.nonce);
      if (seen.size > 128) seen.delete(seen.values().next().value!);
    }
    listener(value.kind, remote);
  };
  const local = (event: Event) => receive((event as CustomEvent).detail, false);
  const storage = (event: StorageEvent) => {
    if (event.key !== STORAGE_KEY || !event.newValue) return;
    try { receive(JSON.parse(event.newValue), true); } catch { /* Ignore malformed signals. */ }
  };
  let channel: BroadcastChannel | undefined;
  try { channel = new BroadcastChannel(CHANNEL); channel.onmessage = (event: MessageEvent<unknown>) => receive(event.data, true); } catch { /* Non-personal storage signal fallback. */ }
  window.addEventListener(LOCAL_EVENT, local); window.addEventListener("storage", storage);
  return () => { channel?.close(); window.removeEventListener(LOCAL_EVENT, local); window.removeEventListener("storage", storage); };
}
