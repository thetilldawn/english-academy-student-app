export type UnitRangeDisplayGroup = { label: string; unitLabels: readonly string[] };

function numberedUnit(label: string) {
  const match = /^(.*\bDAY\s*)(\d+)$/i.exec(label) ?? /^(.*?)(\d+)(과(?:\s.*)?)$/.exec(label);
  return match ? { prefix: match[1]!, number: Number(match[2]), suffix: match[3] ?? "" } : null;
}

/** Display only. Keep the original sequence and all labels, including unknown exam names. */
export function unitRangeDisplayGroups(labels: readonly string[]): UnitRangeDisplayGroup[] {
  const groups: UnitRangeDisplayGroup[] = [];
  let index = 0;
  while (index < labels.length) {
    const start = index;
    const first = numberedUnit(labels[index]!);
    let previous = first;
    let direction = 0;
    while (first && previous && index + 1 < labels.length) {
      const next = numberedUnit(labels[index + 1]!);
      if (!next || next.prefix !== first.prefix || next.suffix !== first.suffix) break;
      const step = next.number - previous.number;
      if (Math.abs(step) !== 1 || (direction !== 0 && step !== direction)) break;
      direction = step;
      previous = next;
      index += 1;
    }
    const unitLabels = labels.slice(start, index + 1);
    groups.push({ label: start === index ? labels[start]! : `${labels[start]}~${labels[index]}`, unitLabels });
    index += 1;
  }
  return groups;
}

export function unitRangeDisplayLabel(labels: readonly string[]): string | null {
  return labels.length ? unitRangeDisplayGroups(labels).map(group => group.label).join(" · ") : null;
}
