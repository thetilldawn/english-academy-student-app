const DAY_MILLISECONDS = 24 * 60 * 60 * 1000;

export type BulkAssignmentSessionSchedule = {
  sessionNumber: number;
  availableFrom: string;
  availableUntil: string | null;
};

export function shiftIsoByDays(value: string, days: number): string {
  return new Date(Date.parse(value) + days * DAY_MILLISECONDS).toISOString();
}

export function resolveBulkAssignmentSchedule(input: {
  sessionCount: number;
  firstAvailableFrom: string;
  firstAvailableUntil: string | null;
  dayInterval: number;
}): BulkAssignmentSessionSchedule[] {
  return Array.from({ length: input.sessionCount }, (_, index) => {
    const dayOffset = index * input.dayInterval;
    return {
      sessionNumber: index + 1,
      availableFrom: shiftIsoByDays(input.firstAvailableFrom, dayOffset),
      availableUntil: input.firstAvailableUntil
        ? shiftIsoByDays(input.firstAvailableUntil, dayOffset)
        : null,
    };
  });
}
