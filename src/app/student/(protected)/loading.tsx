import { studentAppText } from "@/content/ko/student-app";
import { RouteLoadingState } from "@/design-system/patterns/route-state/route-state";

export default function StudentLoading() {
  return <RouteLoadingState label={studentAppText.login.loading} />;
}
