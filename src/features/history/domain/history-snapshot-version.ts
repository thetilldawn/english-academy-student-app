/** Compare DB instants without rounding away fractional seconds. */
export function isHistorySnapshotAtLeast(candidate: string, minimum: string) {
  const parts = (value: string) => {
    const match = /^(.*T\d{2}:\d{2}:\d{2})(?:\.(\d+))?(Z|[+-]\d{2}:\d{2})$/.exec(value);
    if (!match) return null;
    const second = Date.parse(match[1]! + match[3]!);
    return Number.isFinite(second) ? { second, fraction: match[2] ?? "" } : null;
  };
  const a = parts(candidate), b = parts(minimum);
  if (!a || !b) return false;
  if (a.second !== b.second) return a.second > b.second;
  const length = Math.max(a.fraction.length, b.fraction.length);
  return a.fraction.padEnd(length, "0") >= b.fraction.padEnd(length, "0");
}
