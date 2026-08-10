import { adminShellText } from "@/content/ko/admin-shell";
import { ButtonSpinner } from "@/design-system/primitives/button/button";

export default function AdminLoading() {
  return (
    <div aria-live="polite" className="admin-route-loading" role="status">
      <ButtonSpinner />
      <span>{adminShellText.loading}</span>
    </div>
  );
}
