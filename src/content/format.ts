export function formatContentText(
  template: string,
  values: Record<string, string | number>,
) {
  return template.replace(/\{([a-zA-Z0-9_]+)\}/g, (match, key: string) =>
    key in values ? String(values[key]) : match,
  );
}
