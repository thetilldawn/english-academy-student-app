export default function AdminLoading() {
  return (
    <div aria-live="polite" className="admin-route-loading" role="status">
      <span className="button-spinner" aria-hidden="true" />
      <span>화면을 불러오는 중…</span>
    </div>
  );
}
