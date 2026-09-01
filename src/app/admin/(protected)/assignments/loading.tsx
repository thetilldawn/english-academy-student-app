import { adminLearningText } from "@/content/ko/admin-learning";
import { RouteLoadingState } from "@/design-system/patterns/route-state/route-state";

export default function AssignmentsLoading() {
  return <RouteLoadingState label={adminLearningText.page.loading} />;
}
