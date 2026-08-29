import { getAppOrigin } from "@/lib/env";
import { loadCurrentAdminMaterialSnapshotForRsc } from "@/lib/services/admin-material-read-service";

import { StudentCreateWorkspace } from "../../ui/student-create-workspace";

export async function StudentCreateContent() {
  const material = await loadCurrentAdminMaterialSnapshotForRsc();
  return (
    <StudentCreateWorkspace
      appOrigin={getAppOrigin()}
      datasets={material.selectableDatasets}
    />
  );
}
