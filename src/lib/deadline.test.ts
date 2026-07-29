import { describe, expect, it } from "vitest";

import {
  formatRemainingSeconds,
  koreanDateTimeLocalToIso,
  secondsUntil,
} from "@/lib/deadline";

describe("koreanDateTimeLocalToIso", () => {
  it("한국시간 입력을 고정된 UTC 시각으로 바꾼다", () => {
    expect(koreanDateTimeLocalToIso("2026-07-31T23:59")).toBe(
      "2026-07-31T14:59:00.000Z",
    );
  });

  it("존재하지 않는 날짜와 형식 오류를 거절한다", () => {
    expect(koreanDateTimeLocalToIso("2026-02-30T12:00")).toBeNull();
    expect(koreanDateTimeLocalToIso("2026-07-31 23:59")).toBeNull();
  });
});

describe("secondsUntil", () => {
  const deadline = "2026-07-31T15:00:00.000Z";

  it.each([
    [59_000, 59],
    [60_000, 60],
    [3_599_000, 3599],
    [3_600_000, 3600],
    [86_399_000, 86399],
    [86_400_000, 86400],
  ])("%i밀리초 차이를 %i초로 계산한다", (difference, expected) => {
    const deadlineTime = Date.parse(deadline);
    expect(secondsUntil(deadline, deadlineTime - difference)).toBe(
      expected,
    );
  });

  it("마감과 같은 시각 및 이후는 0초다", () => {
    const deadlineTime = Date.parse(deadline);
    expect(secondsUntil(deadline, deadlineTime)).toBe(0);
    expect(secondsUntil(deadline, deadlineTime + 1)).toBe(0);
  });

  it("마감 없음과 잘못된 ISO는 계산하지 않는다", () => {
    expect(secondsUntil(null, Date.now())).toBeNull();
    expect(secondsUntil("not-a-date", Date.now())).toBeNull();
  });
});

describe("formatRemainingSeconds", () => {
  it("일·시간·분·초를 고정 폭으로 표시한다", () => {
    expect(formatRemainingSeconds(93784)).toBe(
      "1일 02시간 03분 04초",
    );
  });

  it("음수는 모두 0으로 표시한다", () => {
    expect(formatRemainingSeconds(-1)).toBe(
      "0일 00시간 00분 00초",
    );
  });
});
