const INTERNAL_TITLE_SUFFIX =
  /\s+(?:승인\s+)?pilot\s+\d+(?:\s+v[\w.-]+)?$/iu;

const INTERNAL_EDITION =
  /(?:^|[-_\s])pilot(?:[-_\s]|$)|^v\d+(?:[._-]\d+)*$/iu;

function compactWhitespace(value: string) {
  return value.replace(/\s+/gu, " ").trim();
}

export function cleanDatasetTitle(title: string) {
  return compactWhitespace(title).replace(INTERNAL_TITLE_SUFFIX, "").trim();
}

export function isInternalDatasetEdition(edition: string | null | undefined) {
  return Boolean(edition?.trim() && INTERNAL_EDITION.test(edition.trim()));
}

export function datasetDisplayLabel(
  title: string,
  edition?: string | null,
) {
  const cleanTitle = cleanDatasetTitle(title) || "단어장";
  const cleanEdition = compactWhitespace(edition ?? "");

  if (
    !cleanEdition ||
    isInternalDatasetEdition(cleanEdition) ||
    cleanTitle.toLocaleLowerCase().includes(cleanEdition.toLocaleLowerCase())
  ) {
    return cleanTitle;
  }

  return `${cleanTitle} · ${cleanEdition}`;
}

export function storedDatasetDisplayLabel(label: string) {
  const normalized = compactWhitespace(label);
  const parts = normalized.split(/\s+·\s+/u);

  if (parts.length < 2) {
    return cleanDatasetTitle(normalized) || "단어장";
  }

  const edition = parts.at(-1) ?? "";
  const title = parts.slice(0, -1).join(" · ");
  return datasetDisplayLabel(title, edition);
}
