"use client";
import { Button } from "@/design-system/primitives/button/button";
import type { StudyManifest } from "../../contracts/study-materials";
import type { StudyPresentation } from "../../contracts/assignment-study";
import { useSharedStudy } from "../../controller/use-shared-study";
import { AssignmentStudyFrame } from "../../ui/assignment-study-frame";
import { AssignmentStudyReader } from "./assignment-study-reader";
export function CachedAssignmentStudyReader({ manifest, presentation }: { manifest: StudyManifest; presentation: StudyPresentation }) {
  const { study, error, retry, blockedIdentity } = useSharedStudy(manifest);
  if (study) return <AssignmentStudyReader study={study} presentation={presentation} />;
  return <AssignmentStudyFrame title={blockedIdentity ? "단어 보기" : manifest.title} presentation={presentation}>
    <p role={error ? "alert" : "status"}>{error || "단어 자료를 준비하고 있습니다."}</p>
    {error ? <Button onClick={retry}>다시 확인</Button> : null}
  </AssignmentStudyFrame>;
}
