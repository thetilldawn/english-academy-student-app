import { adminShellText } from "@/content/ko/admin-shell";
import { RouteLoadingState } from "@/design-system/patterns/route-state/route-state";

export default function AdminLoading() {
  return <RouteLoadingState label={adminShellText.loading} role="status" />;
}
