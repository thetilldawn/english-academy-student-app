import { EMPTY_LIBRARY_FILTERS, libraryFiltersSchema, templateMetadataSchema, type LibraryClassification, type LibraryFilters, type LibraryRecipe, type LibraryScope, type TemplateMetadata } from "../contracts/library";
import { matchesLibraryScope } from "./library-selection";

export type LibraryKind = LibraryClassification["kind"];
export const LIBRARY_KIND_LABELS: Record<LibraryKind, string> = { mock: "모의고사", csat: "수능", textbook: "교과서", wordbook: "단어장", school: "학교 자료", unclassified: "기타 자료" };
export const LIBRARY_KINDS: LibraryKind[] = ["mock", "csat", "textbook", "wordbook", "school", "unclassified"];
export const gradeLabel = (value: string) => ({ g7: "중1", g8: "중2", g9: "중3", g10: "고1", g11: "고2", g12: "고3" })[value] ?? value;
export const needsBook = (kind: LibraryKind) => kind !== "mock" && kind !== "csat";
type ScopeRef = LibraryRecipe["scopes"][number];
export type LibraryGroup = { id: string; kind: LibraryKind; datasetId: string | null; filters: LibraryFilters; scopes: ScopeRef[]; manual: boolean };

/** Source-specific fields never leak into a different kind of material. */
export function kindFilters(kind: LibraryKind, value: LibraryFilters = EMPTY_LIBRARY_FILTERS): LibraryFilters {
  const common = { ...EMPTY_LIBRARY_FILTERS, kinds: [kind], search: value.search, sourceGrades: value.sourceGrades };
  if (kind === "mock" || kind === "csat") return { ...common, years: value.years, yearFrom: value.yearFrom, yearTo: value.yearTo,
    months: kind === "mock" ? value.months : [], types: value.types, questions: value.questions };
  if (kind === "wordbook") return { ...common, dayFrom: value.dayFrom, dayTo: value.dayTo };
  if (kind === "textbook") return { ...common, lessons: value.lessons };
  if (kind === "school") return { ...common, schools: value.schools, targetGrades: value.targetGrades, semesters: value.semesters, assessments: value.assessments };
  return common;
}

export function groupSources(catalog: readonly LibraryScope[], group: LibraryGroup) {
  return catalog.filter(s => s.classification.kind === group.kind && (!group.datasetId || s.source.datasetId === group.datasetId));
}
export function groupMatches(catalog: readonly LibraryScope[], group: LibraryGroup) {
  if (needsBook(group.kind) && !group.datasetId) return [];
  return groupSources(catalog, group).filter(s => s.availability === "available" && matchesLibraryScope(s, group.filters));
}
export function recalculateGroup(catalog: readonly LibraryScope[], group: LibraryGroup): LibraryGroup {
  if (!libraryFiltersSchema.safeParse(group.filters).success) return group;
  return { ...group, manual: false, scopes: groupMatches(catalog, group).map(s => ({ id: s.id, version: s.version })) };
}
export function newLibraryGroup(catalog: readonly LibraryScope[], kind: LibraryKind, id: string): LibraryGroup {
  return recalculateGroup(catalog, { id, kind, datasetId: null, filters: kindFilters(kind), scopes: [], manual: false });
}

const unique = <T>(values: T[]) => [...new Set(values)];
function inferredFilters(scopes: LibraryScope[], kind: LibraryKind) {
  const c = scopes.map(s => s.classification), exams = c.flatMap(v => v.exam ? [v.exam] : []);
  const days = c.flatMap(v => v.day === null ? [] : [v.day]);
  return kindFilters(kind, { ...EMPTY_LIBRARY_FILTERS, years: unique(exams.map(e => e.executionYear)),
    months: unique(exams.map(e => e.examMonth)), types: unique(exams.map(e => e.typeCode)),
    questions: unique(exams.flatMap(e => e.questionNumbers)), sourceGrades: unique(c.flatMap(v => v.sourceGrade ? [v.sourceGrade] : [])),
    lessons: unique(c.flatMap(v => v.lesson === null ? [] : [v.lesson])),
    dayFrom: days.length ? Math.min(...days) : null, dayTo: days.length ? Math.max(...days) : null });
}

/** Opening a saved recipe must never expand correlations or reorder its references. */
export function restoreLibraryGroups(catalog: readonly LibraryScope[], recipe: LibraryRecipe): LibraryGroup[] {
  const byId = new Map(catalog.map(s => [s.id, s]));
  const groups: LibraryGroup[] = [];
  for (const ref of recipe.scopes) {
    const scope = byId.get(ref.id), kind = scope?.classification.kind ?? "unclassified";
    const datasetId = needsBook(kind) ? scope?.source.datasetId ?? null : null;
    const last = groups.at(-1);
    if (last && last.kind === kind && last.datasetId === datasetId) last.scopes.push(ref);
    else groups.push({ id: `saved-${groups.length}`, kind, datasetId, scopes: [ref], filters: kindFilters(kind), manual: true });
  }
  return groups.map(group => {
    const selected = group.scopes.flatMap(ref => { const s = byId.get(ref.id); return s && s.version === ref.version ? [s] : []; });
    let filters = inferredFilters(selected, group.kind);
    const exact = (f: LibraryFilters) => {
      const matches = groupMatches(catalog, { ...group, filters: f });
      return selected.length === group.scopes.length && matches.length === group.scopes.length &&
        matches.every(s => group.scopes.some(ref => ref.id === s.id && ref.version === s.version));
    };
    if (!exact(filters)) return group;
    // Avoid hiding redundant constraints, e.g. topic + Q23 blocking a switch to gist.
    for (const key of ["questions", "sourceGrades", "months", "years", "types", "lessons"] as const) {
      const simpler = { ...filters, [key]: [] };
      if (exact(simpler)) filters = simpler;
    }
    return { ...group, filters, manual: false };
  });
}

export function groupsRecipe(catalog: readonly LibraryScope[], groups: LibraryGroup[], previous: LibraryRecipe): LibraryRecipe {
  const scopes: ScopeRef[] = [], seen = new Set<string>();
  for (const group of groups) for (const ref of group.scopes) if (!seen.has(ref.id)) { scopes.push(ref); seen.add(ref.id); }
  const reachable = new Set(catalog.filter(s => seen.has(s.id)).flatMap(s => s.occurrences.map(r => r.key)));
  return { ...previous, filters: EMPTY_LIBRARY_FILTERS, scopes, scopeStatus: previous.scopeStatus,
    excludedOccurrenceKeys: previous.excludedOccurrenceKeys.filter(k => reachable.has(k)) };
}

export function libraryScopeLabel(scope: Pick<LibraryScope, "name" | "classification">) {
  const exam = scope.classification.exam;
  if (!exam || scope.classification.kind !== "csat") return scope.name;
  return `${exam.academicYear ? `${exam.academicYear}학년도 수능` : "수능"} (${exam.executionYear}년 시행) · ${exam.typeLabel} [${exam.questionNumbers.join("·")}번]`;
}

function numbers(values: number[]) {
  const list = unique(values).sort((a, b) => a - b);
  if (list.length > 2 && list.every((v, i) => i === 0 || v === list[i - 1]! + 1)) return `${list[0]}~${list.at(-1)}`;
  return list.join("·");
}

/** Tags describe the actual selected version, never its last search query. */
export function libraryAutomaticTags(catalog: readonly LibraryScope[], recipe: LibraryRecipe, metadata: TemplateMetadata): string[] {
  const refs = new Map(recipe.scopes.map(r => [r.id, r.version]));
  const excluded = new Set(recipe.excludedOccurrenceKeys);
  const scopes = catalog.filter(s => refs.get(s.id) === s.version && s.occurrences.some(r => r.state === "included" && !excluded.has(r.key)));
  return libraryTagsFromClassifications(scopes.map(s => s.classification), metadata);
}

export function libraryTagsFromClassifications(c: LibraryClassification[], metadata: TemplateMetadata): string[] {
  const mock = c.flatMap(v => v.kind === "mock" && v.exam ? [v.exam] : []);
  const csat = c.flatMap(v => v.kind === "csat" && v.exam ? [v.exam] : []);
  const compact = (prefix: string, values: number[], suffix: string) => values.length ? `${prefix}${numbers(values)}${suffix}` : null;
  const tags = [metadata.purpose, metadata.school, metadata.targetGrade && `대상 ${gradeLabel(metadata.targetGrade)}`,
    metadata.schoolYear && `${metadata.schoolYear}년 준비`, metadata.semester && `${metadata.semester}학기`, metadata.assessment,
    ...unique(c.map(v => LIBRARY_KIND_LABELS[v.kind])), ...unique(c.flatMap(v => v.sourceGrade ? [`원자료 ${gradeLabel(v.sourceGrade)}`] : [])),
    compact("", mock.map(e => e.executionYear), "년 모고"), compact("", mock.map(e => e.examMonth), "월"),
    compact("수능 ", csat.map(e => e.executionYear), "년 시행"), compact("", csat.flatMap(e => e.academicYear ? [e.academicYear] : []), "학년도 수능"),
    ...unique(c.flatMap(v => v.exam ? [v.exam.typeLabel] : [])),
    compact("DAY ", c.flatMap(v => v.day === null ? [] : [v.day]), ""), compact("", c.flatMap(v => v.lesson === null ? [] : [v.lesson]), "과"),
  ];
  return unique(tags.filter((s): s is string => typeof s === "string" && s.trim().length > 0).map(s => s.slice(0, 40))).slice(0, 30);
}
export function suggestedLibraryTitle(catalog: readonly LibraryScope[], recipe: LibraryRecipe, metadata: TemplateMetadata) {
  const tags = libraryAutomaticTags(catalog, recipe, metadata).filter(t => !t.startsWith("원자료 ") && !t.endsWith("년 준비"));
  return tags.join(" · ").slice(0, 100);
}

export function libraryEditorErrors(metadata: TemplateMetadata, recipe: LibraryRecipe, groups: LibraryGroup[], included: number | null, selectionError: boolean) {
  const errors: Record<string, string> = {};
  const parsed = templateMetadataSchema.safeParse(metadata);
  if (!parsed.success) for (const issue of parsed.error.issues) {
    const key = String(issue.path[0]);
    errors[key] = key === "title" ? "템플릿 이름을 입력해 주세요." : key === "schoolYear" ? "시험 준비 연도는 2000~2100년으로 입력해 주세요." : "입력한 내용을 확인해 주세요.";
  }
  if (recipe.scopeStatus === "confirmed") {
    if (groups.some(g => !libraryFiltersSchema.safeParse(g.filters).success)) errors.range = "범위의 시작과 끝을 확인해 주세요.";
    else if (groups.some(g => !g.scopes.length)) errors.range = "비어 있는 자료 묶음의 범위를 고르거나 그 묶음을 빼 주세요.";
    else if (!recipe.scopes.length) errors.range = "자료 종류와 범위를 선택해 주세요.";
    else if (selectionError) errors.range = "사용할 수 없는 범위가 있습니다. 자료 상태와 선택을 확인해 주세요.";
    else if (included === 0) errors.range = "포함할 단어가 없습니다. 범위 또는 단어별 제외를 확인해 주세요.";
  }
  return errors;
}
