const KOREA_OFFSET_HOURS = 9;
const LOCAL_DATE_TIME_PATTERN =
  /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/;

export function currentTimeMilliseconds(): number {
  return Date.now();
}

export function koreanDateTimeLocalToIso(value: string): string | null {
  const match = LOCAL_DATE_TIME_PATTERN.exec(value);
  if (!match) return null;

  const [, yearText, monthText, dayText, hourText, minuteText] = match;
  const year = Number(yearText);
  const month = Number(monthText);
  const day = Number(dayText);
  const hour = Number(hourText);
  const minute = Number(minuteText);
  const utcMilliseconds = Date.UTC(
    year,
    month - 1,
    day,
    hour - KOREA_OFFSET_HOURS,
    minute,
  );
  const koreaWallClock = new Date(
    utcMilliseconds + KOREA_OFFSET_HOURS * 60 * 60 * 1000,
  );

  if (
    koreaWallClock.getUTCFullYear() !== year ||
    koreaWallClock.getUTCMonth() !== month - 1 ||
    koreaWallClock.getUTCDate() !== day ||
    koreaWallClock.getUTCHours() !== hour ||
    koreaWallClock.getUTCMinutes() !== minute
  ) {
    return null;
  }

  return new Date(utcMilliseconds).toISOString();
}

export function isoToKoreanDateTimeLocal(value: string | null): string {
  if (!value) return "";
  const milliseconds = Date.parse(value);
  if (Number.isNaN(milliseconds)) return "";
  const koreaWallClock = new Date(
    milliseconds + KOREA_OFFSET_HOURS * 60 * 60 * 1000,
  );
  const year = koreaWallClock.getUTCFullYear();
  const month = (koreaWallClock.getUTCMonth() + 1)
    .toString()
    .padStart(2, "0");
  const day = koreaWallClock.getUTCDate().toString().padStart(2, "0");
  const hour = koreaWallClock.getUTCHours().toString().padStart(2, "0");
  const minute = koreaWallClock
    .getUTCMinutes()
    .toString()
    .padStart(2, "0");
  return `${year}-${month}-${day}T${hour}:${minute}`;
}

export function secondsUntil(
  deadlineAt: string | null,
  nowMilliseconds: number,
): number | null {
  if (!deadlineAt) return null;
  const deadlineMilliseconds = Date.parse(deadlineAt);
  if (Number.isNaN(deadlineMilliseconds)) return null;

  return Math.max(
    0,
    Math.ceil((deadlineMilliseconds - nowMilliseconds) / 1000),
  );
}

export function millisecondsUntil(
  deadlineAt: string | null,
  nowMilliseconds: number,
): number | null {
  if (!deadlineAt) return null;
  const deadlineMilliseconds = Date.parse(deadlineAt);
  if (Number.isNaN(deadlineMilliseconds)) return null;

  return Math.max(0, deadlineMilliseconds - nowMilliseconds);
}

export function formatRemainingSeconds(totalSeconds: number): string {
  const safeSeconds = Math.max(0, Math.floor(totalSeconds));
  const days = Math.floor(safeSeconds / 86400);
  const hours = Math.floor((safeSeconds % 86400) / 3600);
  const minutes = Math.floor((safeSeconds % 3600) / 60);
  const seconds = safeSeconds % 60;

  return `${days}일 ${hours.toString().padStart(2, "0")}시간 ${minutes
    .toString()
    .padStart(2, "0")}분 ${seconds.toString().padStart(2, "0")}초`;
}
