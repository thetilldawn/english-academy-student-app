import { expect, it } from "vitest";
import { fakeId, fakeMeaning, fakeMistakeView } from "../controller/mistake-test-fixtures";
import { selectMistakeTarget, selectableMistakes } from "./mistake-selection";
it("자료 필터가 다른 뜻을 선택하지 않으며 선택 자료의 문항과 단계를 함께 보낸다", () => {
  const meaning = fakeMeaning(), page = fakeMistakeView(), other = fakeMeaning(2);
  meaning.sourceDatasetId = fakeId(11);
  meaning.sources[0].sourcePhase = "retry";
  other.sources[0].datasetId = fakeId(11); other.sourceDatasetId = fakeId(11);
  page.filters = { ...page.filters, datasetId: fakeId(10) };
  page.items[0].meanings = [meaning, other];
  const selected = [...selectableMistakes(page, "next_exam").values()];
  expect(selected).toHaveLength(1);
  expect(selected[0]).toMatchObject({ sourceQuestionId: meaning.sources[0].sourceQuestionId, sourcePhase: "retry", meaningKey: meaning.meaningKey });
  meaning.sources[0].episodeId = fakeId(999);
  expect(selectMistakeTarget(meaning, fakeId(10))).toBeNull();
});
it("문제지는 대기와 배정 여부와 별도로 고르되 해결된 뜻이나 지난 구간은 선택하지 않는다", () => {
  const page = fakeMistakeView(), meaning = page.items[0].meanings[0];
  meaning.scheduling = "assigned";
  expect(selectableMistakes(page, "next_exam").size).toBe(0);
  expect(selectableMistakes(page, "worksheet").size).toBe(1);
  meaning.isCurrentEpisode = false;
  expect(selectableMistakes(page, "worksheet").size).toBe(0);
});
