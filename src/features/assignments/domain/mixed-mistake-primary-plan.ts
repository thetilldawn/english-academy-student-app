type QuestionDirection = "english_to_korean" | "korean_to_english";

export type MixedPrimaryOption = {
  direction: QuestionDirection;
  meaningKey: string;
  meaningProofHash: string;
};
export type MixedPrimaryCandidate = { entryId: number; options: readonly MixedPrimaryOption[] };
export type MixedPrimaryPick = MixedPrimaryOption & { entryId: number; sourceIndex: number };
type Row = MixedPrimaryCandidate & { sourceIndex: number };
type State = { n: number; e: number; mask: bigint; path: MixedPrimaryPick[] };

export class PrimaryPlannerLimitError extends Error {
  readonly code = "primary_planner_limit";
  constructor() { super("뜻 중복을 확인하는 계산 한도를 넘었습니다. 범위를 줄여 다시 확인해 주세요."); }
}

// 배열 순서는 원자료 순서다. 출처가 다른 같은 뜻은 하나만, 다른 뜻은 별도로 선택한다.
export function selectMixedPrimaryExact(input: {
  candidates: readonly MixedPrimaryCandidate[];
  totalQuestionCount: number;
  englishCount: number;
  review: { meaningKeys: readonly string[]; englishMin: number; englishMax: number };
  blockedMeaningKeys?: readonly string[];
  limits?: { states: number; steps: number };
}): { primary: MixedPrimaryPick[]; reviewEnglishCount: number } | null {
  const E: QuestionDirection = "english_to_korean";
  const { totalQuestionCount: N, englishCount: targetE, review } = input;
  const limits = input.limits ?? { states: 100_000, steps: 2_000_000 };
  const R = review.meaningKeys.length, G = N - R;
  const reserved = new Set(review.meaningKeys), ids = new Set<number>();
  if (![N, targetE, review.englishMin, review.englishMax, limits.states, limits.steps].every(Number.isInteger) ||
      N < 0 || N > 500 || targetE < 0 || targetE > N || G < 0 ||
      review.englishMin < 0 || review.englishMax > R || review.englishMin > review.englishMax ||
      reserved.size !== R || review.meaningKeys.some(key => !key) || limits.states < 1 || limits.steps < 1) {
    throw new Error("출제 계획 입력이 올바르지 않습니다.");
  }
  for (const key of input.blockedMeaningKeys ?? []) reserved.add(key);
  let steps = 0;
  const tick = (cost = 1) => { steps += cost; if (steps > limits.steps) throw new PrimaryPlannerLimitError(); };
  const minE = Math.max(0, targetE - review.englishMax), maxE = Math.min(G, targetE - review.englishMin);
  if (minE > maxE) return null;
  const rows: Row[] = [];
  input.candidates.forEach((candidate, sourceIndex) => {
    if (!Number.isSafeInteger(candidate.entryId) || candidate.entryId < 1 || ids.has(candidate.entryId) ||
        candidate.options.length > 2 || new Set(candidate.options.map(o => o.direction)).size !== candidate.options.length ||
        candidate.options.some(o => !o.meaningKey || !o.meaningProofHash ||
          (o.direction !== E && o.direction !== "korean_to_english"))) {
      throw new Error("항목 또는 방향별 뜻 증명이 중복되거나 잘못되었습니다.");
    }
    ids.add(candidate.entryId);
    const options = candidate.options.filter(o => !reserved.has(o.meaningKey)).slice()
      .sort((a, b) => Number(b.direction === E) - Number(a.direction === E));
    if (options.length) rows.push({ ...candidate, options, sourceIndex });
  });
  if (rows.length < G || new Set(rows.flatMap(row => row.options.map(option => option.meaningKey))).size < G) return null;
  const earlier = (a: readonly MixedPrimaryPick[], b: readonly MixedPrimaryPick[]) => {
    tick(a.length + 1);
    for (let i = 0; i < Math.min(a.length, b.length); i++) {
      if (a[i].sourceIndex !== b[i].sourceIndex) return a[i].sourceIndex < b[i].sourceIndex;
    }
    return a.length < b.length;
  };
  const pick = (row: Row, option: MixedPrimaryOption): MixedPrimaryPick => ({ ...option, entryId: row.entryId, sourceIndex: row.sourceIndex });
  const admissible = (n: number, e: number) => n <= G && e <= maxE && n - e <= G - minE;
  const keep = (map: Map<string, State>, value: State) => {
    const key = `${value.n}/${value.e}/${value.mask}`, previous = map.get(key);
    if (!previous || earlier(value.path, previous.path)) map.set(key, value);
    if (map.size > limits.states) throw new PrimaryPlannerLimitError();
  };
  const zero = (): State => ({ n: 0, e: 0, mask: BigInt(0), path: [] });
  const owners = new Map<string, number[]>();
  rows.forEach((row, index) => {
    for (const key of new Set(row.options.map(o => o.meaningKey))) {
      const values = owners.get(key) ?? []; values.push(index); owners.set(key, values);
    }
  });
  const parent = rows.map((_, index) => index);
  const root = (value: number): number => {
    let index = value;
    while (parent[index] !== index) { parent[index] = parent[parent[index]]; index = parent[index]; }
    return index;
  };
  for (const values of owners.values()) for (let i = 1; i < values.length; i++) parent[root(values[i])] = root(values[0]);
  const groups = new Map<number, Row[]>();
  rows.forEach((row, index) => { const key = root(index), group = groups.get(key) ?? []; group.push(row); groups.set(key, group); });
  const sharedGroups = [...groups.values()].filter(g => g.length > 1);
  const solo = [...groups.values()].filter(g => g.length === 1).flat().sort((a, b) => a.sourceIndex - b.sourceIndex);
  type Counts = { e: number; k: number; b: number };
  const kind = (row: Row): keyof Counts => row.options.length === 2 ? "b" : row.options[0].direction === E ? "e" : "k";
  const suffix: Counts[] = Array.from({ length: solo.length + 1 }, () => ({ e: 0, k: 0, b: 0 }));
  for (let i = solo.length - 1; i >= 0; i--) { suffix[i] = { ...suffix[i + 1] }; suffix[i][kind(solo[i])]++; }
  function completeSolo(count: number, minimum: number, maximum: number) {
    const low = Math.max(0, minimum), high = Math.min(count, maximum);
    if (count < 0 || low > high) return null;
    const feasible = (n: number, e: number, k: number, rest: Counts) => n <= count && e <= high && k <= count - low &&
      rest.b + Math.min(rest.e, high - e) + Math.min(rest.k, count - low - k) >= count - n;
    if (!feasible(0, 0, 0, suffix[0])) return null;
    const selected: Row[] = []; let onlyE = 0, onlyK = 0;
    for (let i = 0; i < solo.length && selected.length < count; i++) {
      tick();
      const row = solo[i], type = kind(row), e = onlyE + Number(type === "e"), k = onlyK + Number(type === "k");
      if (!feasible(selected.length + 1, e, k, suffix[i + 1])) continue;
      selected.push(row); onlyE = e; onlyK = k;
    }
    if (selected.length !== count) throw new Error("방향 선택 내부 오류");
    const english = Math.max(low, onlyE); let bothEnglish = english - onlyE;
    const path = selected.map(row => {
      const type = kind(row), useEnglish = type === "e" || (type === "b" && bothEnglish-- > 0);
      return pick(row, row.options.find(o => (o.direction === E) === useEnglish)!);
    });
    return { path, english };
  }
  // 공유 뜻이 없는 일반적인 범위는 후보 수에 비례해 처리한다.
  if (!sharedGroups.length) {
    const result = completeSolo(G, minE, maxE);
    return result && { primary: result.path, reviewEnglishCount: targetE - result.english };
  }
  let combined = new Map<string, State>(); keep(combined, zero());
  for (const group of sharedGroups) {
    const bits = new Map<string, bigint>();
    for (const row of group) for (const option of row.options) {
      if (owners.get(option.meaningKey)!.length > 1 && !bits.has(option.meaningKey)) bits.set(option.meaningKey, BigInt(1) << BigInt(bits.size));
    }
    let states = new Map<string, State>(); keep(states, zero());
    for (const row of group) {
      tick(states.size);
      const next = new Map(states);
      for (const state of states.values()) for (const option of row.options) {
        tick(); const bit = bits.get(option.meaningKey) ?? BigInt(0), n = state.n + 1, e = state.e + Number(option.direction === E);
        if ((state.mask & bit) !== BigInt(0) || !admissible(n, e)) continue;
        tick(n);
        keep(next, { n, e, mask: state.mask | bit, path: [...state.path, pick(row, option)] });
      }
      states = next;
    }
    const pairs = new Map<string, State>();
    for (const state of states.values()) keep(pairs, { ...state, mask: BigInt(0) });
    const nextCombined = new Map<string, State>();
    for (const left of combined.values()) for (const right of pairs.values()) {
      tick(); const n = left.n + right.n, e = left.e + right.e;
      if (!admissible(n, e)) continue;
      tick(n * Math.max(1, Math.ceil(Math.log2(n + 1))));
      keep(nextCombined, { n, e, mask: BigInt(0), path: [...left.path, ...right.path].sort((a, b) => a.sourceIndex - b.sourceIndex) });
    }
    combined = nextCombined;
  }
  let best: { primary: MixedPrimaryPick[]; reviewEnglishCount: number } | null = null;
  for (const state of combined.values()) {
    tick(); const rest = completeSolo(G - state.n, minE - state.e, maxE - state.e);
    if (!rest) continue;
    tick(G * Math.max(1, Math.ceil(Math.log2(G + 1))));
    const primary = [...state.path, ...rest.path].sort((a, b) => a.sourceIndex - b.sourceIndex);
    if (!best || earlier(primary, best.primary)) best = { primary, reviewEnglishCount: targetE - state.e - rest.english };
  }
  return best;
}
