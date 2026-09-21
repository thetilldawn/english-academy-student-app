import { hash as digest } from "node:crypto";
import { EMPTY_LIBRARY_FILTERS, type LibraryCatalog, type LibraryRecipe, type LibraryVersion, type TemplateMetadata } from "../contracts/library";
import { type LibraryCriteria, type LibraryQuery } from "../contracts/library-query";
import { libraryAutomaticTags, suggestedLibraryTitle } from "../domain/library-editor";
import { matchesLibraryScope, resolveLibraryRecipe } from "../domain/library-selection";
import { compareLibraryVersions, matchesTemplate } from "../domain/template-version";

export const versionSummary = (v: LibraryVersion, hasCriteria = false) => ({ id: v.id, number: v.number, contentHash: v.contentHash, scopeStatus: v.recipe.scopeStatus,
  scopeCount: v.recipe.scopes.length, sourceCount: v.sourceCount, includedCount: v.includedKeys.length, sourceVersionId: v.sourceVersionId, datasetId: v.datasetId, createdAt: v.createdAt, hasCriteria });
export function queryFixture(q: LibraryQuery, catalog: LibraryCatalog, savedCriteria: Map<string, LibraryCriteria>) {
  const base = { kind: q.kind, viewerId: catalog.viewerId };
  const allVersions = catalog.templates.flatMap(t => t.versions);
  const summary = (t: LibraryCatalog["templates"][number]) => ({ id: t.id, revision: t.revision, metadata: t.metadata, latestVersion: versionSummary(t.versions[0]!, savedCriteria.has(t.versions[0]!.id)) });
  const page = <T,>(items: T[]) => {
    const offset = "cursor" in q && q.cursor ? Number(q.cursor.after) : 0, limit = "limit" in q ? q.limit : 20;
    return { items: items.slice(offset, offset + limit), nextCursor: offset + limit < items.length ? { binding: "a".repeat(64), snapshot: 1, after: String(offset + limit) } : null };
  };
  function selected(selection: Extract<LibraryQuery, { kind: "preview" }>["selection"]) {
    if (selection.mode === "recipe") return { recipe: selection.recipe, groups: [] };
    const c = selection.criteria;
    const groups = c.groups.map(g => ({ id: g.id, scopes: g.mode === "fixed" ? g.scopes : catalog.scopes.filter(s => s.availability === "available" && s.classification.kind === g.kind &&
      ((g.kind === "mock" || g.kind === "csat") || g.datasetId) && (!g.datasetId || s.source.datasetId === g.datasetId) && !g.excludedScopeKeys.includes(`scope-${s.id}`) && matchesLibraryScope(s, g.filters)).map(s => ({ id: s.id, version: s.version })) }));
    return { groups, recipe: { filters: EMPTY_LIBRARY_FILTERS, scopes: [...new Map(groups.flatMap(g => g.scopes).map(r => [r.id, r])).values()], excludedOccurrenceKeys: c.excludedOccurrenceKeys, scopeStatus: c.scopeStatus } satisfies LibraryRecipe };
  }
  function hash(recipe: LibraryRecipe) {
    const identity = (r: LibraryRecipe) => JSON.stringify([r.scopes, r.excludedOccurrenceKeys, r.scopeStatus]);
    return allVersions.find(v => identity(v.recipe) === identity(recipe))?.contentHash ?? digest("sha256", identity(recipe), "hex");
  }
  if (q.kind === "templates") return { ...base, ...page(catalog.templates.filter(t => matchesTemplate(t, q.search)).map(summary)) };
  if (q.kind === "versions") return { ...base, ...page(catalog.templates.find(t => t.id === q.templateId)!.versions.map(v => versionSummary(v, savedCriteria.has(v.id)))) };
  if (q.kind === "detail") {
    const t = catalog.templates.find(t => t.id === q.templateId)!, v = t.versions.find(v => v.id === q.versionId) ?? t.versions[0]!;
    const empty: TemplateMetadata = { title: "", tags: [], school: null, targetGrade: null, schoolYear: null, semester: null, assessment: null, purpose: null };
    return { ...base, template: summary(t), version: versionSummary(v, savedCriteria.has(v.id)), criteria: savedCriteria.get(v.id) ?? null, recipe: v.recipe,
      automaticTags: libraryAutomaticTags(catalog.scopes, v.recipe, t.metadata), sourceTags: libraryAutomaticTags(catalog.scopes, v.recipe, empty) };
  }
  if (q.kind === "scopes") {
    const scopes = q.refs ? q.refs.flatMap(r => catalog.scopes.filter(s => s.id === r.id && s.version === r.version)) : catalog.scopes.filter(s => (!q.datasetId || s.source.datasetId === q.datasetId) && matchesLibraryScope(s, q.filters));
    return { ...base, ...page(scopes.map(s => { const { occurrences, ...header } = s; return { ...header, scopeKey: `scope-${s.id}`, sourceCount: occurrences.length, includedCount: occurrences.filter(r => r.state === "included").length, heldCount: occurrences.filter(r => r.state === "held").length }; })) };
  }
  if (q.kind === "preview") {
    const { recipe, groups } = selected(q.selection), reachable = new Set(catalog.scopes.filter(s => recipe.scopes.some(r => r.id === s.id)).flatMap(s => s.occurrences.map(r => r.key)));
    const orphanedExclusions = recipe.excludedOccurrenceKeys.filter(k => !reachable.has(k));
    recipe.excludedOccurrenceKeys = recipe.excludedOccurrenceKeys.filter(k => reachable.has(k));
    const resolved = resolveLibraryRecipe(catalog.scopes, recipe), previous = allVersions.find(v => v.id === q.compareVersionId);
    const compare = previous ? compareLibraryVersions(previous, { includedKeys: resolved.included.map(r => r.key) }) : null;
    return { ...base, recipe, contentHash: hash(recipe), sourceCount: resolved.sourceCount, includedCount: resolved.includedCount, heldCount: resolved.heldCount, excludedCount: resolved.excludedCount,
      groups, orphanedExclusions, difference: previous && compare ? { added: compare.added.length, removed: compare.removed.length, orderChanged: compare.orderChanged,
        scopeAdded: recipe.scopes.filter(r => !previous.recipe.scopes.some(x => x.id === r.id)).length, scopeRemoved: previous.recipe.scopes.filter(r => !recipe.scopes.some(x => x.id === r.id)).length, changed: hash(recipe) !== previous.contentHash } : null,
      automaticTags: libraryAutomaticTags(catalog.scopes, recipe, q.metadata), suggestedTitle: suggestedLibraryTitle(catalog.scopes, recipe, q.metadata) };
  }
  if (q.kind === "words") {
    const recipe = q.versionId ? allVersions.find(v => v.id === q.versionId)!.recipe : selected(q.selection!).recipe;
    const rows = resolveLibraryRecipe(catalog.scopes, recipe).occurrences.filter(r => `${r.headword ?? ""} ${r.meaning ?? ""}`.includes(q.search));
    return { ...base, total: rows.length, ...page(rows.map(r => ({ key: r.key, sourceRow: r.sourceRow, headword: r.headword ?? null, meaning: r.meaning ?? null, state: r.state, selected: r.state === "included" && !recipe.excludedOccurrenceKeys.includes(r.key) }))) };
  }
  const source = catalog.scopes.filter(s => s.classification.kind === q.sourceKind && (!q.datasetId || s.source.datasetId === q.datasetId));
  const option = (values: (string | number | null | undefined)[]) => [...new Set(values.filter((v): v is string | number => v !== null && v !== undefined))].sort().map(v => ({ value: v, label: String(v), count: values.filter(x => x === v).length }));
  const classes = source.map(s => s.classification), exams = classes.flatMap(c => c.exam ? [c.exam] : []);
  const books = page([...new Map(catalog.scopes.filter(s => s.classification.kind === q.sourceKind && s.sourceTitle.includes(q.bookSearch)).map(s => [s.source.datasetId, { id: s.source.datasetId, title: s.sourceTitle, count: 1 }])).values()]);
  const types = [...new Map(catalog.scopes.flatMap(s => s.classification.exam ? [[s.classification.exam.typeCode, s.classification.exam.typeLabel] as const] : [])).entries()].map(([value, label]) => ({ value, label, count: exams.filter(e => e.typeCode === value).length }));
  return { ...base, nextCursor: books.nextCursor, facets: { books: books.items, sourceGrades: option(classes.map(c => c.sourceGrade)),
    years: option(exams.map(e => e.executionYear)).map(o => ({ ...o, label: q.sourceKind === "csat" ? `${o.value}년 시행 · ${exams.find(e => e.executionYear === o.value)?.academicYear}학년도` : o.label })),
    months: option(exams.map(e => e.examMonth)), types, questions: option(exams.flatMap(e => e.questionNumbers)), lessons: option(classes.map(c => c.lesson)), schools: option(classes.map(c => c.school)),
    targetGrades: option(classes.map(c => c.targetGrade)), semesters: option(classes.map(c => c.semester)), assessments: option(classes.map(c => c.assessment)) } };
}
