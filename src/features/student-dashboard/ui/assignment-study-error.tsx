"use client";

import { studentAppText } from "@/content/ko/student-app";
import { Button } from "@/design-system/primitives/button/button";
import type { StudyPresentation } from "../contracts/assignment-study";
import { AssignmentStudyFrame } from "./assignment-study-frame";

export function AssignmentStudyError({ presentation, retry }: { presentation: StudyPresentation; retry: () => void }) {
  return <AssignmentStudyFrame presentation={presentation}>
    <p role="alert">{studentAppText.study.loadError}</p>
    <Button onClick={retry}>{studentAppText.study.retry}</Button>
  </AssignmentStudyFrame>;
}
