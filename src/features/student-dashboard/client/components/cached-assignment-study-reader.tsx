"use client";
import { Button, ButtonSpinner } from "@/design-system/primitives/button/button";
import type { OpenStudyAccess } from "../../contracts/study-materials";
import { assignmentReleaseNotice } from "@/lib/assignment/assignment-release";
import type { StudyPresentation } from "../../contracts/assignment-study";
import { useSharedStudy } from "../../controller/use-shared-study";
import { AssignmentStudyFrame } from "../../ui/assignment-study-frame";
import { AssignmentStudyReader } from "./assignment-study-reader";
import styles from "../../ui/assignment-study.module.css";
export function CachedAssignmentStudyReader({ access, presentation }: { access: OpenStudyAccess; presentation: StudyPresentation }) {
  const { study, locked, error, retry, blockedIdentity } = useSharedStudy(access);
  if (study) return <AssignmentStudyReader study={study} presentation={presentation} />;
  return <AssignmentStudyFrame title={blockedIdentity ? "단어 보기" : access.title} presentation={presentation}>
    <p className={styles.loading} role={error ? "alert" : "status"}>{!error && !locked ? <ButtonSpinner /> : null}{error || (locked ? assignmentReleaseNotice(locked.release) : "단어 자료를 준비하고 있습니다.")}</p>
    {error || locked ? <Button onClick={retry}>다시 확인</Button> : null}
  </AssignmentStudyFrame>;
}
