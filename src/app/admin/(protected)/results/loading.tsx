import { adminHistoryText } from "@/content/ko/admin-history";
import { RouteLoadingState } from "@/design-system/patterns/route-state/route-state";

export default function ResultsLoading() {
  return <RouteLoadingState label={adminHistoryText.page.loading} />;
}
