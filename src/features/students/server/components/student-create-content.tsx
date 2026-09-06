import { getAppOrigin } from "@/lib/env";

import { StudentCreateWorkspace } from "../../ui/student-create-workspace";

export function StudentCreateContent() {
  return (
    <StudentCreateWorkspace
      appOrigin={getAppOrigin()}
    />
  );
}
