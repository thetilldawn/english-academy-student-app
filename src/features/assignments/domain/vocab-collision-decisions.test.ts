import { describe, expect, it } from "vitest";

import {
  buildVocabCollisionDecisionInput,
  clearVocabCollisionDecisionFrom,
  setVocabCollisionDecision,
  vocabCollisionActionPolicy,
  type VocabCollisionDecisionRecord,
} from "./vocab-collision-decisions";

function record(
  collisionId: string,
  sourceSessionNumber: number,
  mode: "skip" | "move" | "allow" = "move",
): VocabCollisionDecisionRecord {
  return {
    collisionId,
    availableFrom: "2026-08-17T09:00:00.000Z",
    availableUntil: "2026-08-18T13:00:00.000Z",
    studentId: "student-1",
    studentName: "김학생",
    sourceSessionNumber,
    unitLabel: `DAY ${sourceSessionNumber}`,
    warningMessage: "같은 날 시험이 있습니다.",
    warningKind: "existing_assignment",
    decision: { collisionId, mode },
  };
}

describe("겹침 결정 이력", () => {
  it("경고 종류별 허용 동작을 UI 밖에서 고정한다", () => {
    expect(vocabCollisionActionPolicy("existing_assignment")).toEqual({
      canClear: false,
      decisionModes: ["skip", "move", "allow"],
    });
    expect(vocabCollisionActionPolicy("planned_series_order")).toEqual({
      canClear: true,
      decisionModes: ["skip", "move"],
    });
    const context = {
      collisionId: "collision-1",
      availableFrom: "2026-08-21T09:00:00.000Z",
      availableUntil: "2026-08-21T10:00:00.000Z",
      studentId: "student-1",
      studentName: "김학생",
      sourceSessionNumber: 1,
      unitLabel: "DAY 01",
      warningMessage: "앞 회차 이동과 겹칩니다.",
      warningKind: "planned_series_order" as const,
    };
    expect(buildVocabCollisionDecisionInput(context, "move")).toEqual({
      ...context,
      mode: "move",
    });
    expect(buildVocabCollisionDecisionInput(context, "allow")).toBeNull();
  });

  it("앞 이동 결정을 바꾸면 같은 회차의 뒤 이동 연쇄를 버린다", () => {
    const first = record("collision-1", 1);
    const second = record("collision-2", 1);
    const other = record("collision-3", 2);
    const current = [first, second, other];
    const changed = setVocabCollisionDecision(
      current,
      record("collision-1", 1, "skip"),
    );
    expect(changed.map((item) => item.decision.collisionId)).toEqual([
      "collision-3",
      "collision-1",
    ]);
    expect(changed.at(-1)?.decision.mode).toBe("skip");
  });

  it("되돌린 지점부터 같은 회차의 뒤 결정을 지우고 다른 회차는 유지한다", () => {
    const cleared = clearVocabCollisionDecisionFrom(
      [record("collision-1", 1), record("collision-2", 1), record("collision-3", 2)],
      "collision-1",
    );
    expect(cleared.map((item) => item.decision.collisionId)).toEqual([
      "collision-3",
    ]);
  });
});
