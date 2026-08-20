/**
 * Stores an in-flight Promise before another concurrent caller can load the
 * same request-scoped value. Callers own the Map, so nothing survives beyond
 * the current preview or save request.
 */
export function memoizeRequestPreparation<Value>(
  cache: Map<string, Promise<Value>>,
  key: string,
  load: () => Promise<Value>,
) {
  const existing = cache.get(key);
  if (existing) return existing;
  const pending = load();
  cache.set(key, pending);
  return pending;
}
