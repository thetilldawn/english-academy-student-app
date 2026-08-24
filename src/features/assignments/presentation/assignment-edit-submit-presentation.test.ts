import { describe, expect, it } from "vitest";

import { assignmentEditSubmitPresentation } from "./assignment-edit-submit-presentation";

describe("수정 저장 오류 표시", () => {
  it("고칠 수 있는 입력 오류는 첫 저장 클릭까지 버튼을 열어 둔다", () => {
    expect(assignmentEditSubmitPresentation({
      blocker: { code: "invalid", path: "questionCount" },
      canSubmit: false,
      submitAttempted: false,
    })).toEqual({ canSubmit: true, showBlockedReason: false });

    expect(assignmentEditSubmitPresentation({
      blocker: { code: "invalid", path: "questionCount" },
      canSubmit: false,
      submitAttempted: true,
    })).toEqual({ canSubmit: false, showBlockedReason: true });
  });

  it("불러오기와 변경 없음은 처음부터 저장을 막는다", () => {
    expect(assignmentEditSubmitPresentation({
      blocker: { code: "unchanged" },
      canSubmit: false,
      submitAttempted: false,
    })).toEqual({ canSubmit: false, showBlockedReason: true });
  });
});
