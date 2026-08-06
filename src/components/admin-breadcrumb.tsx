export function AdminBreadcrumb({
  current,
  section,
}: {
  current: string;
  section?: string;
}) {
  return (
    <nav aria-label="현재 위치" className="admin-breadcrumb">
      {section ? <span>{section}</span> : null}
      {section ? <span aria-hidden="true">/</span> : null}
      <strong aria-current="page">{current}</strong>
    </nav>
  );
}
