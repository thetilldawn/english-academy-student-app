function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value)
        .filter(([, child]) => child !== undefined)
        .sort(([left], [right]) =>
          left < right ? -1 : left > right ? 1 : 0,
        )
        .map(([key, child]) => [key, canonicalize(child)]),
    );
  }
  return value;
}

export function assignmentRequestFingerprint(value: unknown): string {
  return JSON.stringify(canonicalize(value));
}

export type IdempotencyReservation = {
  fingerprint: string;
  key: string;
};

export function reserveIdempotencyKey(
  current: IdempotencyReservation | null,
  fingerprint: string,
  createKey: () => string,
): IdempotencyReservation {
  if (current?.fingerprint === fingerprint) return current;
  return { fingerprint, key: createKey() };
}
