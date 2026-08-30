import { unstable_rethrow } from "next/navigation";

import { adminStudentsText } from "@/content/ko/admin-students";
import { PanelLoadFailure } from "@/design-system/patterns/route-state/route-state";
import { getAppOrigin } from "@/lib/env";
import { loadCurrentAdminMaterialSnapshotForRsc } from "@/lib/services/admin-material-read-service";

import { StudentCreateWorkspace } from "../../ui/student-create-workspace";

export async function StudentCreateContent() {
  let material;
  try {
    material = await loadCurrentAdminMaterialSnapshotForRsc();
  } catch (error) {
    unstable_rethrow(error);
    return (
      <PanelLoadFailure
        message={adminStudentsText.createStudent.loadError}
        retryHref="/admin/students"
        retryLabel={adminStudentsText.page.retry}
      />
    );
  }
  return (
    <StudentCreateWorkspace
      appOrigin={getAppOrigin()}
      datasets={material.selectableDatasets}
    />
  );
}
