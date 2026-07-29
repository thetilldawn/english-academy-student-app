export type PriorWrongLevel = 0 | 1 | 2;

export type PriorWrongIndicator = {
  label: string;
  markerCount: 1 | 2;
};

export function getPriorWrongIndicator(
  level: PriorWrongLevel,
): PriorWrongIndicator | null {
  if (level === 0) return null;

  return level === 1
    ? {
        label: "이전에 한 번 틀린 단어",
        markerCount: 1,
      }
    : {
        label: "이전에 두 번 이상 틀린 단어",
        markerCount: 2,
      };
}
