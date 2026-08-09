export function formatKoreanDateTime(value: string | null): string {
  if (!value) return "-";

  return new Intl.DateTimeFormat("ko-KR", {
    timeZone: "Asia/Seoul",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(new Date(value));
}

export function formatKoreanActivityDateTime(value: string | null): string {
  if (!value) return "";

  const parts = new Intl.DateTimeFormat("ko-KR", {
    timeZone: "Asia/Seoul",
    month: "numeric",
    day: "numeric",
    weekday: "short",
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  }).formatToParts(new Date(value));
  const valueFor = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((part) => part.type === type)?.value ?? "";

  return `${valueFor("month")}월 ${valueFor("day")}일 [${valueFor("weekday")}] ${valueFor("dayPeriod")} ${valueFor("hour")}시 ${valueFor("minute")}분`;
}

export function formatElapsed(seconds: number | null): string {
  if (seconds === null) return "-";
  const minutes = Math.floor(seconds / 60);
  const remainder = seconds % 60;
  return `${minutes}분 ${remainder}초`;
}
