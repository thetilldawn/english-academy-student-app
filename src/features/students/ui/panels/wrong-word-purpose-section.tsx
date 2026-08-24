import { adminStudentsText } from "@/content/ko/admin-students";
import { Button } from "@/design-system/primitives/button/button";
import { HelpTip } from "@/design-system/primitives/tooltip/help-tip";

import type { WrongWordSelectionPurpose } from "../../domain/wrong-word-selection";
import styles from "./student-wrong-word-panel.module.css";
import { WrongWordControlSection } from "./wrong-word-control-section";

export function WrongWordPurposeSection({
  onChange,
  value,
}: {
  onChange: (value: WrongWordSelectionPurpose) => void;
  value: WrongWordSelectionPurpose;
}) {
  const copy = adminStudentsText.learning.wrongWordsPanel;

  return (
    <WrongWordControlSection
      title={copy.sections.purpose}
      titleId="wrong-word-purpose-title"
    >
      <div
        aria-label={copy.purposeAria}
        className={styles.filterChips}
        role="group"
      >
        {(
          [
            ["next_exam", copy.nextExam],
            ["worksheet", copy.worksheet],
          ] as const
        ).map(([purpose, label]) => (
          <Button
            aria-pressed={value === purpose}
            key={purpose}
            onClick={() => onChange(purpose)}
            size="small"
            variant="filter"
          >
            {label}
          </Button>
        ))}
        <HelpTip label={copy.purposeHelpAria} trigger="도움말">
          {value === "worksheet"
            ? adminStudentsText.learning.worksheetWrongWordHelp
            : adminStudentsText.learning.nextExamWrongWordHelp}
        </HelpTip>
      </div>
    </WrongWordControlSection>
  );
}
