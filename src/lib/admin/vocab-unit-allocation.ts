export const ISO_WEEKDAYS = [1, 2, 3, 4, 5, 6, 7] as const;

export type IsoWeekday = (typeof ISO_WEEKDAYS)[number];
export type VocabUnitAllocationMode = "same" | "by_weekday";
export type VocabSplitOverflowPolicy = "leave" | "continue_weekly";
export type VocabWeekdayUnitCounts = Readonly<Record<IsoWeekday, number>>;
export type VocabUnitAllocationRuleV1 = {
  schemaVersion: 1;
  mode: VocabUnitAllocationMode;
  unitsPerSession: number;
  weekdayUnitsPerSession: VocabWeekdayUnitCounts;
};

const CALENDAR_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

function calendarDateIsoWeekday(value: string): IsoWeekday | null {
  if (!CALENDAR_DATE_PATTERN.test(value)) return null;
  const [year, month, day] = value.split("-").map(Number);
  const parsed = new Date(Date.UTC(year, month - 1, day));
  if (
    parsed.getUTCFullYear() !== year ||
    parsed.getUTCMonth() !== month - 1 ||
    parsed.getUTCDate() !== day
  ) {
    return null;
  }
  const weekday = parsed.getUTCDay();
  return (weekday === 0 ? 7 : weekday) as IsoWeekday;
}

/** Resolves counts from the untouched recurrence dates, never moved dates. */
export function resolveVocabUnitCountsForDates(input: {
  dates: readonly string[];
  rule: VocabUnitAllocationRuleV1;
}): number[] {
  return input.dates.map((value) => {
    if (input.rule.mode === "same") return input.rule.unitsPerSession;
    const weekday = calendarDateIsoWeekday(value);
    if (weekday === null) return Number.NaN;
    return input.rule.weekdayUnitsPerSession[weekday];
  });
}
