import { adminStudentsText } from "@/content/ko/admin-students";
import { RouteLoadingState } from "@/design-system/patterns/route-state/route-state";
import { StudentDirectory } from "./student-directory";

export function StudentDirectorySkeleton() {
  return (
    <StudentDirectory privateDataVisible={false} pendingContent={<RouteLoadingState label={adminStudentsText.page.loading} variant="compact" />} />
  );
}
