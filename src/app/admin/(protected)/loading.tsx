import { adminShellText } from "@/content/ko/admin-shell";

export default function AdminLoading() {
  return (
    <div aria-live="polite" className="admin-route-loading" role="status">
      <span className="button-spinner" aria-hidden="true" />
      <span>{adminShellText.loading}</span>
    </div>
  );
}
