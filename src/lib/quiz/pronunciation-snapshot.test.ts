import { describe, expect, it } from "vitest";

import {
  allChoiceAudioAvailable,
  parseChoicePronunciations,
  parseTargetPronunciation,
} from "@/lib/quiz/pronunciation-snapshot";

const officialUrl =
  "https://media.merriam-webster.com/audio/prons/en/us/mp3/t/test0001.mp3";

function choiceSnapshot(index: number, headword: string) {
  return {
    choiceIndex: index,
    displayHeadword: headword,
    displayPronunciationKo: `${headword} 발음`,
    pronunciationVariantId: `mw:${index}`,
    audioStatus: "raw_attached",
    audioUrl: officialUrl,
    listeningEnabled: true,
  };
}

describe("quiz pronunciation snapshots", () => {
  it("공식 Merriam-Webster 스냅샷만 재생 가능하게 만든다", () => {
    expect(
      parseTargetPronunciation({
        displayPronunciationKo: "테스트",
        pronunciationVariantId: "mw:test",
        audioStatus: "raw_attached",
        audioUrl: officialUrl,
        listeningEnabled: true,
      }),
    ).toEqual({
      displayKo: "테스트",
      variantId: "mw:test",
      audioUrl: officialUrl,
      available: true,
    });

    expect(
      parseTargetPronunciation({
        displayPronunciationKo: "가짜",
        pronunciationVariantId: "mw:fake",
        audioStatus: "raw_attached",
        audioUrl: "https://example.com/fake.mp3",
        listeningEnabled: true,
      }),
    ).toMatchObject({ displayKo: "가짜", available: false });
  });

  it("선택지 순서와 표제어가 정확한 네 음원만 한 묶음으로 허용한다", () => {
    const choices = ["alpha", "beta", "gamma", "delta"];
    const parsed = parseChoicePronunciations(
      choices.map((choice, index) => choiceSnapshot(index, choice)),
      choices,
    );
    expect(allChoiceAudioAvailable(parsed)).toBe(true);

    const mismatched = parseChoicePronunciations(
      choices.map((choice, index) =>
        choiceSnapshot(index, index === 2 ? "wrong" : choice),
      ),
      choices,
    );
    expect(allChoiceAudioAvailable(mismatched)).toBe(false);
  });
});
