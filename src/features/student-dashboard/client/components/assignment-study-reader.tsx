"use client";

import { useState } from "react";
import type { AssignmentStudy, StudyPresentation } from "../../contracts/assignment-study";
import { useStudyAudio } from "../../controller/use-study-audio";
import { AssignmentStudyFrame } from "../../ui/assignment-study-frame";
import { AssignmentStudyWords } from "../../ui/assignment-study-words";
import { StudyVisibilityControls } from "../../ui/study-visibility-controls";

export function AssignmentStudyReader({ study, presentation }: { study: AssignmentStudy; presentation: StudyPresentation }) {
  // A single selection makes hiding both study cues impossible.
  const [hiddenColumn, setHiddenColumn] = useState<"english" | "meaning" | null>(null);
  const englishHidden = hiddenColumn === "english";
  const meaningHidden = hiddenColumn === "meaning";
  const { failedWord, play, stop } = useStudyAudio();
  const toggleEnglish = () => {
    if (!englishHidden) stop();
    setHiddenColumn((previous) => previous === "english" ? null : "english");
  };
  return <AssignmentStudyFrame presentation={presentation} title={study.title} controls={
    <StudyVisibilityControls englishHidden={englishHidden} meaningHidden={meaningHidden}
      canHideMeaning={study.mode === "book_meaning_choice"} onToggleEnglish={toggleEnglish}
      onToggleMeaning={() => setHiddenColumn((previous) => previous === "meaning" ? null : "meaning")} />
  }>
    <AssignmentStudyWords study={study} englishHidden={englishHidden} meaningHidden={meaningHidden}
      failedWord={failedWord} onPlay={play} />
  </AssignmentStudyFrame>;
}
