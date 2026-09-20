import type { LibraryTemplate, LibraryVersion, TemplateMetadata } from "../contracts/library";

export function compareLibraryVersions(previous: Pick<LibraryVersion, "includedKeys">, next: Pick<LibraryVersion, "includedKeys">) {
  const before = new Set(previous.includedKeys), after = new Set(next.includedKeys);
  const added = next.includedKeys.filter(key => !before.has(key));
  const removed = previous.includedKeys.filter(key => !after.has(key));
  const commonBefore = previous.includedKeys.filter(key => after.has(key));
  const commonAfter = next.includedKeys.filter(key => before.has(key));
  return { added, removed, orderChanged: commonBefore.some((key, i) => key !== commonAfter[i]) };
}

export function matchesTemplate(template: LibraryTemplate, search: string) {
  const m = template.metadata;
  const text = [m.title, ...m.tags, m.school, m.targetGrade, m.schoolYear, m.semester && `${m.semester}학기`, m.assessment, m.purpose]
    .filter(value => value !== null).join(" ").toLocaleLowerCase("ko-KR");
  return search.trim().toLocaleLowerCase("ko-KR").split(/\s+/).every(term => text.includes(term));
}

/** Presentation edits carry no scope or version fields. */
export function editTemplateMetadata(template: LibraryTemplate, metadata: TemplateMetadata): LibraryTemplate {
  return { ...template, metadata };
}

export function latestLibraryVersion(template: LibraryTemplate) {
  return template.versions.reduce((latest, version) => version.number > latest.number ? version : latest);
}
