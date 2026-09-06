export type StudyTextRange = { start: number; end: number };
export type StudyExamplePart = { text: string; concealed: boolean; start: number };

const escapeLiteral = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
const phrasePattern = (value: string) => value.split(/(\s+)/u)
  .map((part) => /^\s+$/u.test(part) ? "\\s+" : escapeLiteral(part)).join("");

/** Coordinates always refer to the unchanged original, not a normalized copy. */
export function rangeFromStudyPrompt(example: string, prompt: string): StudyTextRange | null {
  if (example.length > 10_000 || prompt.length > 10_000) return null;
  const blanks = [...prompt.matchAll(/_{2,}/gu)];
  if (blanks.length !== 1) return null;
  const blank = blanks[0]!;
  const prefix = prompt.slice(0, blank.index);
  const suffix = prompt.slice(blank.index + blank[0].length);
  const match = new RegExp(`^(${phrasePattern(prefix)})([\\s\\S]+?)(${phrasePattern(suffix)})$`, "u").exec(example);
  if (!match || !match[2]!.trim()) return null;
  const gap = match[2]!;
  const start = match[1]!.length + gap.length - gap.trimStart().length;
  return { start, end: start + gap.trim().length };
}

/** The stored, approved cloze is authoritative; never guess an inflected form. */
export function studyExampleRanges(example: string, headword: string, prompts: readonly string[]): StudyTextRange[] | null {
  const candidates = new Map<string, StudyTextRange>();
  for (const prompt of prompts) {
    const range = rangeFromStudyPrompt(example, prompt);
    if (range) candidates.set(`${range.start}:${range.end}`, range);
  }
  if (candidates.size !== 1) return null;
  const target = [...candidates.values()][0]!;
  const ranges = [target];
  // Also conceal repeated exact target expressions and the literal headword.
  // Letter boundaries prevent e.g. "ill" from hiding "will" or "illness".
  const surfaces = new Set([example.slice(target.start, target.end), headword.trim()]);
  for (const surface of surfaces) {
    if (!surface) continue;
    const pattern = new RegExp(`(^|[^\\p{L}\\p{N}_'’\\-])(${phrasePattern(surface)})(?=$|[^\\p{L}\\p{N}_'’\\-])`, "giu");
    for (const match of example.matchAll(pattern)) {
      const start = match.index + match[1]!.length;
      ranges.push({ start, end: start + match[2]!.length });
    }
  }
  const merged: StudyTextRange[] = [];
  for (const range of ranges.sort((a, b) => a.start - b.start || a.end - b.end)) {
    const previous = merged.at(-1);
    if (previous && range.start <= previous.end) previous.end = Math.max(previous.end, range.end);
    else merged.push({ ...range });
  }
  return merged;
}

export function splitStudyExample(example: string, ranges: readonly StudyTextRange[] | null | undefined): StudyExamplePart[] | null {
  if (!ranges?.length) return null;
  const parts: StudyExamplePart[] = [];
  let cursor = 0;
  for (const { start, end } of ranges) {
    if (!Number.isInteger(start) || !Number.isInteger(end) || start < cursor || end <= start || end > example.length) return null;
    if (start > cursor) parts.push({ text: example.slice(cursor, start), concealed: false, start: cursor });
    parts.push({ text: example.slice(start, end), concealed: true, start });
    cursor = end;
  }
  if (cursor < example.length) parts.push({ text: example.slice(cursor), concealed: false, start: cursor });
  return parts;
}
