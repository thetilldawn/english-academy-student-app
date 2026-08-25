const pointNumberFormat = new Intl.NumberFormat("ko-KR", {
  maximumFractionDigits: 0,
});

function safeInteger(value: number) {
  return Number.isSafeInteger(value) ? value : 0;
}

export function formatVisiblePoints(value: number) {
  return pointNumberFormat.format(Math.max(0, safeInteger(value)));
}

export function formatPointChange(value: number) {
  const safeValue = safeInteger(value);
  if (safeValue > 0) return `+${pointNumberFormat.format(safeValue)}`;
  return pointNumberFormat.format(safeValue);
}
