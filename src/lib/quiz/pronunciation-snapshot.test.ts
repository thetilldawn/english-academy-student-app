import { describe, expect, it } from "vitest";

import {
  approvedKoreanPronunciationKey,
  allChoiceAudioAvailable,
  mergeKoreanPronunciationRegistries,
  parseChoiceDictionaryIds,
  parseChoicePronunciations,
  parseApprovedKoreanPronunciation,
  parseRuleDerivedKoreanPronunciation,
  parseRegistryPronunciation,
  parseSyntheticRegistryPronunciation,
  parseTargetPronunciation,
  parseVocabPronunciationIdentityV2,
  preferredPronunciation,
  preferredPronunciationWithActiveVocaRelease,
  preferredPronunciationWithApprovedKorean,
  syntheticAudioProfilePriority,
  sortSyntheticAudioBindingsByProfilePriority,
  withApprovedKoreanPronunciation,
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
  it("새 일반 속도 합성 프로필을 이전 프로필보다 우선한다", () => {
    expect(syntheticAudioProfilePriority("profile:5b6efb0ecc8f4702")).toBe(1);
    expect(syntheticAudioProfilePriority("profile:75ca7f418d66e6ab")).toBe(1);
    expect(syntheticAudioProfilePriority("profile:286866721f7f4ee8")).toBe(2);
    expect(syntheticAudioProfilePriority("profile:1a77d56d47e26013")).toBe(2);

    const normal = { asset_id: "synthetic:normal" };
    const slow = { asset_id: "synthetic:slow" };
    const priority = new Map([
      [normal.asset_id, 2],
      [slow.asset_id, 1],
    ]);
    expect(
      sortSyntheticAudioBindingsByProfilePriority(
        [normal, slow],
        priority,
      ).map(({ asset_id }) => asset_id),
    ).toEqual([slow.asset_id, normal.asset_id]);
    expect(
      sortSyntheticAudioBindingsByProfilePriority(
        [slow, normal],
        priority,
      ).map(({ asset_id }) => asset_id),
    ).toEqual([slow.asset_id, normal.asset_id]);
  });

  it("공식 Merriam-Webster 스냅샷만 재생 가능하게 만든다", () => {
    expect(
      parseTargetPronunciation({
        displayPronunciationKo: "테스트",
        koSegments: [
          { text: "테", stress: false },
          { text: "스트", stress: true },
        ],
        pronunciationVariantId: "mw:test",
        audioStatus: "raw_attached",
        audioUrl: officialUrl,
        listeningEnabled: true,
      }),
    ).toEqual({
      displayKo: "테스트",
      segments: [
        { text: "테", stress: "none" },
        { text: "스트", stress: "primary" },
      ],
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

  it("표시 문자열과 정확히 맞는 구조화 강세만 전달한다", () => {
    expect(
      parseTargetPronunciation({
        displayPronunciationKo: "어플라이 포어",
        ko_segments: [
          { text: "어플", stress: "none" },
          { text: "라이 ", stress: "primary" },
          { text: "포어", stress: "primary" },
        ],
      }).segments,
    ).toEqual([
      { text: "어플", stress: "none" },
      { text: "라이 ", stress: "primary" },
      { text: "포어", stress: "primary" },
    ]);
    expect(
      parseTargetPronunciation({
        displayPronunciationKo: "어플라이 포어",
        koSegments: [{ text: "다른 발음", stress: "primary" }],
      }).segments,
    ).toBeUndefined();
    expect(
      parseTargetPronunciation({
        displayPronunciationKo: "secondary only",
        segments: [
          { text: "secondary ", stress: "secondary" },
          { text: "only", stress: "none" },
        ],
      }).segments,
    ).toBeUndefined();
  });

  it("승인된 동일 발음 변이의 한글 강세만 시험 발음에 합친다", () => {
    const approved = parseApprovedKoreanPronunciation({
      dictionary_id: "word:inevitable",
      pronunciation_variant_id: "mw:inevitable",
      display_pronunciation_ko: "이네버터블",
      segments: [
        { text: "이", stress: "none" },
        { text: "네", stress: "primary" },
        { text: "버터블", stress: "none" },
      ],
      review_status: "approved",
    });
    const snapshot = parseTargetPronunciation({
      displayPronunciationKo: "이네버터블",
      pronunciationVariantId: "mw:inevitable",
      audioStatus: "raw_attached",
      audioUrl: officialUrl,
      listeningEnabled: true,
    });

    expect(
      approvedKoreanPronunciationKey(
        "word:inevitable",
        "mw:inevitable",
      ),
    ).toBe("word:inevitable\u0000mw:inevitable");
    expect(
      withApprovedKoreanPronunciation(snapshot, approved).segments,
    ).toEqual([
      { text: "이", stress: "none" },
      { text: "네", stress: "primary" },
      { text: "버터블", stress: "none" },
    ]);
    expect(
      withApprovedKoreanPronunciation(
        { ...snapshot, variantId: "mw:different" },
        approved,
      ).segments,
    ).toBeUndefined();
  });

  it("현재 규칙 엔진이 만든 최종 음원용 한글 강세만 허용한다", () => {
    const row = {
      dictionary_id: "word:meanwhile",
      pronunciation_variant_id: "mw:288fb5a854433c5f7580",
      display_pronunciation_ko: "민와일",
      segments: [
        { text: "민", stress: "primary" },
        { text: "와일", stress: "secondary" },
      ],
      derivation_status: "rule_derived",
      engine_version: "cmudict-hangul-align-v2",
      confidence: "high",
      confidence_scope: "hangul_alignment_only",
      stress_evidence: "selected_webster_lexical_stress",
      display_enabled: true,
    };

    expect(parseRuleDerivedKoreanPronunciation(row)).toMatchObject({
      displayKo: "민와일",
      variantId: "mw:288fb5a854433c5f7580",
      segments: row.segments,
    });
    expect(
      parseRuleDerivedKoreanPronunciation({
        ...row,
        pronunciation_variant_id: "ttsword:meanwhile",
      }),
    ).toBeUndefined();
    expect(
      parseRuleDerivedKoreanPronunciation({
        ...row,
        engine_version: "cmudict-hangul-nucleus-align-v3",
      }),
    ).toMatchObject({
      displayKo: "민와일",
      variantId: "mw:288fb5a854433c5f7580",
    });
    expect(
      parseRuleDerivedKoreanPronunciation({
        ...row,
        engine_version: "cmudict-hangul-align-v1",
      }),
    ).toBeUndefined();
    expect(
      parseRuleDerivedKoreanPronunciation({
        ...row,
        segments: [
          { text: "민", stress: "primary" },
          { text: "와일", stress: "primary" },
        ],
      }),
    ).toBeUndefined();
  });

  it("사람이 승인한 강세가 같은 음원의 규칙 생성 강세보다 우선한다", () => {
    const key = "word:inspire\u0000mw:817aa8db8ea99d67d2dc";
    const derived = {
      displayKo: "인스파이어",
      segments: [{ text: "인스파이어", stress: "primary" as const }],
      variantId: "mw:817aa8db8ea99d67d2dc",
      audioUrl: null,
      available: false,
    };
    const approved = {
      ...derived,
      segments: [
        { text: "인", stress: "none" as const },
        { text: "스파이", stress: "primary" as const },
        { text: "어", stress: "none" as const },
      ],
    };

    expect(
      mergeKoreanPronunciationRegistries(
        new Map([[key, approved]]),
        new Map([[key, derived]]),
      ).get(key),
    ).toBe(approved);
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

  it("Webster raw 연결표의 선택값이 전체 변이에 있을 때만 재생한다", () => {
    const registry = {
      vocab_entry_id: 1,
      provider: "merriam_webster",
      status: "raw_first_variant_unreviewed",
      review_status: "raw_unreviewed",
      listening_enabled: true,
      selected_variant_id: "mw:raw-1",
      selected_audio_url: officialUrl,
      variants: [
        {
          variant_id: "mw:raw-1",
          audio_url: officialUrl,
          pos: "noun",
        },
      ],
    };
    expect(parseRegistryPronunciation(registry)).toMatchObject({
      variantId: "mw:raw-1",
      audioUrl: officialUrl,
      available: true,
    });

    expect(
      parseRegistryPronunciation({
        ...registry,
        variants: [],
      }),
    ).toMatchObject({ available: false });
  });

  it("승인·검증된 Google 합성 표현 자산만 현재 Supabase 공개 URL로 만든다", () => {
    const requestHash = "1".repeat(64);
    const row = {
      asset_id: `synthetic:${requestHash}`,
      dictionary_id: "expression:emerge-from-4925a141",
      speech_text: "emerge from",
      profile_id: "profile:5b6efb0ecc8f4702",
      provider: "google_cloud_text_to_speech",
      model: "chirp3-hd",
      voice: "en-US-Chirp3-HD-Despina",
      pronunciation_variant_id: null,
      pronunciation_identity_type: "dictionary_expression",
      pronunciation_mode: "provider_default_expression",
      canonical_ipa: null,
      google_tts_ipa: null,
      request_sha256: requestHash,
      storage_bucket: "vocab-pronunciation-audio",
      storage_object_key: `pronunciation/google_cloud_text_to_speech/profile-5b6efb0ecc8f4702/${requestHash}.mp3`,
      review_status: "profile_approved_generated",
      storage_verified: true,
      playback_enabled: true,
      canonical_pronunciation_approval_implied: false,
    };
    expect(
      parseSyntheticRegistryPronunciation(
        row,
        "https://wojxpruvbjzbhrpmsbuy.supabase.co",
      ),
    ).toEqual({
      displayKo: null,
      variantId: `synthetic:${requestHash}`,
      audioUrl: `https://wojxpruvbjzbhrpmsbuy.supabase.co/storage/v1/object/public/vocab-pronunciation-audio/pronunciation/google_cloud_text_to_speech/profile-5b6efb0ecc8f4702/${requestHash}.mp3`,
      available: true,
    });
    expect(
      parseSyntheticRegistryPronunciation(
        { ...row, canonical_pronunciation_approval_implied: true },
        "https://wojxpruvbjzbhrpmsbuy.supabase.co",
      ),
    ).toMatchObject({ available: false });
  });

  it("단어 표면형·IPA 고정·출현 구절 합성 자산을 각각의 승인 규칙으로만 허용한다", () => {
    const supabaseUrl = "https://wojxpruvbjzbhrpmsbuy.supabase.co";
    const wordRow = (requestHash: string) => ({
      asset_id: `synthetic:${requestHash}`,
      dictionary_id: "word:selflessness",
      speech_text: "selflessness",
      profile_id: "profile:75ca7f418d66e6ab",
      provider: "google_cloud_text_to_speech",
      model: "chirp3-hd",
      voice: "en-US-Chirp3-HD-Despina",
      pronunciation_variant_id: "ttsword:selflessness:selflessness:noun",
      pronunciation_identity_type: "dictionary_word_surface",
      pronunciation_mode: "provider_default_word_surface",
      canonical_ipa: null,
      google_tts_ipa: null,
      request_sha256: requestHash,
      storage_bucket: "vocab-pronunciation-audio",
      storage_object_key: `pronunciation/google_cloud_text_to_speech/profile-75ca7f418d66e6ab/${requestHash}.mp3`,
      review_status: "profile_approved_generated",
      storage_verified: true,
      playback_enabled: true,
      canonical_pronunciation_approval_implied: false,
    });

    const providerDefault = wordRow("2".repeat(64));
    expect(
      parseSyntheticRegistryPronunciation(providerDefault, supabaseUrl),
    ).toMatchObject({ available: true });

    const customIpa = {
      ...wordRow("3".repeat(64)),
      dictionary_id: "word:artifact",
      speech_text: "artefact",
      pronunciation_variant_id: "ttsword:artifact:artefact:noun",
      pronunciation_mode: "custom_ipa_word_surface",
      canonical_ipa: "ˈɑrtəˌfækt",
      google_tts_ipa: "ˈɑːɹtəˌfækt",
    };
    expect(parseSyntheticRegistryPronunciation(customIpa, supabaseUrl)).toMatchObject({
      available: true,
    });

    const occurrencePhrase = {
      ...wordRow("4".repeat(64)),
      dictionary_id: "word:strike",
      speech_text: "disaster struck",
      pronunciation_variant_id: "ttsocc:569e8f15fa62aa2f369de722:disaster-struck",
      pronunciation_identity_type: "occurrence_word_phrase",
    };
    expect(
      parseSyntheticRegistryPronunciation(occurrencePhrase, supabaseUrl),
    ).toMatchObject({ available: true });

    expect(
      parseSyntheticRegistryPronunciation(
        {
          ...occurrencePhrase,
          pronunciation_mode: "custom_ipa_word_surface",
          canonical_ipa: "dɪˈzæstɚ strʌk",
          google_tts_ipa: "dɪˈzæstɚ stɹʌk",
        },
        supabaseUrl,
      ),
    ).toMatchObject({ available: false });
  });

  it("시험 공식음원, Webster 연결표, Google 합성음원 순서를 지킨다", () => {
    const unavailable = parseTargetPronunciation({}, "이머지 프럼");
    const official = {
      displayKo: null,
      variantId: "mw:official",
      audioUrl: officialUrl,
      available: true,
    };
    const synthetic = {
      displayKo: null,
      variantId: "synthetic:test",
      audioUrl: "https://wojxpruvbjzbhrpmsbuy.supabase.co/synthetic.mp3",
      available: true,
    };
    expect(preferredPronunciation(unavailable, official, synthetic)).toMatchObject({
      variantId: "mw:official",
      displayKo: "이머지 프럼",
    });
    expect(preferredPronunciation(unavailable, undefined, synthetic)).toMatchObject({
      variantId: "synthetic:test",
      displayKo: "이머지 프럼",
    });
  });

  it("최종 Google 합성음원을 고른 뒤 같은 자산에 승인된 구동사 강세를 붙인다", () => {
    const dictionaryId = "expression:apply-for-4f26363d";
    const assetId =
      "synthetic:5906e950416fd2752329ef5ecc1761c62fd47d154a80f30fd171682596724458";
    const synthetic = {
      displayKo: null,
      variantId: assetId,
      audioUrl:
        "https://wojxpruvbjzbhrpmsbuy.supabase.co/storage/v1/object/public/vocab-pronunciation-audio/apply-for.mp3",
      available: true,
    };
    const approved = {
      displayKo: "어플라이 포어",
      segments: [
        { text: "어플", stress: "none" as const },
        { text: "라이", stress: "primary" as const },
        { text: " 포어", stress: "none" as const },
      ],
      variantId: assetId,
      audioUrl: null,
      available: false,
    };
    const approvedRegistry = new Map([
      [approvedKoreanPronunciationKey(dictionaryId, assetId), approved],
    ]);

    expect(
      preferredPronunciationWithApprovedKorean(
        dictionaryId,
        parseTargetPronunciation({}, "어플라이 포어"),
        undefined,
        synthetic,
        approvedRegistry,
      ),
    ).toEqual({
      ...synthetic,
      displayKo: "어플라이 포어",
      segments: approved.segments,
    });
    expect(
      preferredPronunciationWithApprovedKorean(
        dictionaryId,
        parseTargetPronunciation({}, "어플라이 포어"),
        undefined,
        { ...synthetic, variantId: `synthetic:${"0".repeat(64)}` },
        approvedRegistry,
      ).segments,
    ).toBeUndefined();
  });

  it("다른 발음 변이의 음원에는 기존 강세 구간을 붙이지 않는다", () => {
    const snapshot = {
      displayKo: "프로그램",
      segments: [
        { text: "프로", stress: "primary" as const },
        { text: "그램", stress: "none" as const },
      ],
      variantId: "mw:verb",
      audioUrl: null,
      available: false,
    };
    const fallback = {
      displayKo: null,
      variantId: "mw:noun",
      audioUrl: officialUrl,
      available: true,
    };

    expect(preferredPronunciation(snapshot, fallback, undefined)).toEqual({
      displayKo: "프로그램",
      variantId: "mw:noun",
      audioUrl: officialUrl,
      available: true,
    });
  });

  it("선택지 표제어와 순서가 맞을 때만 합성 연결용 사전 ID를 꺼낸다", () => {
    const choices = ["alpha", "beta", "gamma", "delta"];
    const snapshots = choices.map((choice, choiceIndex) => ({
      choiceIndex,
      displayHeadword: choice,
      dictionaryId: `expression:${choice}-12345678`,
    }));
    expect(parseChoiceDictionaryIds(snapshots, choices)).toEqual(
      choices.map((choice) => `expression:${choice}-12345678`),
    );
    expect(
      parseChoiceDictionaryIds(
        snapshots.map((item, index) =>
          index === 1 ? { ...item, displayHeadword: "wrong" } : item,
        ),
        choices,
      ),
    ).toEqual([null, null, null, null]);
  });

  it("활성 VOCA Webster 음원과 한글 강세를 한 묶음으로 읽는다", () => {
    const pronunciation = parseVocabPronunciationIdentityV2(
      {
        identity_id: `pron:v2:${"1".repeat(64)}`,
        pronunciation_variant_id: `mw:${"2".repeat(20)}`,
        audio_provider: "merriam_webster",
        official_audio_url: officialUrl,
        sound_audio: "test0001",
        storage_bucket: null,
        storage_object_key: null,
        audio_sha256: null,
        byte_count: null,
        profile_id: null,
        request_sha256: null,
        model: null,
        voice: null,
        display_pronunciation_ko: "테스트",
        segments: [
          { text: "테", stress: "primary" },
          { text: "스트", stress: "none" },
        ],
        engine_version: "cmudict-arpabet-hangul-render-v1",
        playback_enabled: true,
        display_enabled: true,
        identity_content_sha256: "A".repeat(64),
      },
      "https://wojxpruvbjzbhrpmsbuy.supabase.co",
    );
    expect(pronunciation).toEqual({
      displayKo: "테스트",
      segments: [
        { text: "테", stress: "primary" },
        { text: "스트", stress: "none" },
      ],
      variantId: `mw:${"2".repeat(20)}`,
      audioUrl: officialUrl,
      available: true,
    });

    expect(
      parseVocabPronunciationIdentityV2(
        {
          identity_id: `pron:v3:${"3".repeat(64)}`,
          pronunciation_variant_id: `mw:${"2".repeat(20)}`,
          audio_provider: "merriam_webster",
          official_audio_url: officialUrl,
          sound_audio: "test0001",
          storage_bucket: null,
          storage_object_key: null,
          audio_sha256: null,
          byte_count: null,
          profile_id: null,
          request_sha256: null,
          model: null,
          voice: null,
          display_pronunciation_ko: "포어헤드",
          segments: [
            { text: "포", stress: "primary" },
            { text: "어", stress: "none" },
            { text: "헤", stress: "secondary" },
            { text: "드", stress: "none" },
          ],
          engine_version: "cmudict-arpabet-hangul-nucleus-render-v2",
          playback_enabled: true,
          display_enabled: true,
          identity_content_sha256: "A".repeat(64),
        },
        "https://wojxpruvbjzbhrpmsbuy.supabase.co",
      )?.segments,
    ).toEqual([
      { text: "포", stress: "primary" },
      { text: "어", stress: "none" },
      { text: "헤", stress: "secondary" },
      { text: "드", stress: "none" },
    ]);
    expect(
      parseVocabPronunciationIdentityV2(
        {
          identity_id: `pron:v2:${"3".repeat(64)}`,
          pronunciation_variant_id: `mw:${"2".repeat(20)}`,
          audio_provider: "merriam_webster",
          official_audio_url: officialUrl,
          sound_audio: "test0001",
          storage_bucket: null,
          storage_object_key: null,
          audio_sha256: null,
          byte_count: null,
          profile_id: null,
          request_sha256: null,
          model: null,
          voice: null,
          display_pronunciation_ko: "포어헤드",
          segments: [{ text: "포어헤드", stress: "primary" }],
          engine_version: "cmudict-arpabet-hangul-nucleus-render-v2",
          playback_enabled: true,
          display_enabled: true,
          identity_content_sha256: "A".repeat(64),
        },
        "https://wojxpruvbjzbhrpmsbuy.supabase.co",
      ),
    ).toBeUndefined();
  });

  it("활성 VOCA Google 음원은 고정된 Storage 경로만 허용한다", () => {
    const requestHash = "3".repeat(64);
    const row = {
      identity_id: `pron:v2:${"1".repeat(64)}`,
      pronunciation_variant_id: `synthetic:${requestHash}`,
      audio_provider: "google_cloud_text_to_speech",
      official_audio_url: null,
      sound_audio: null,
      storage_bucket: "vocab-pronunciation-audio",
      storage_object_key:
        `pronunciation/google_cloud_text_to_speech/profile-75ca7f418d66e6ab/ability-voca-etymology-2025-v1/${requestHash}.mp3`,
      audio_sha256: "4".repeat(64),
      byte_count: 4096,
      profile_id: "profile:75ca7f418d66e6ab",
      request_sha256: requestHash,
      model: "chirp3-hd",
      voice: "en-US-Chirp3-HD-Despina",
      display_pronunciation_ko: "테스트",
      segments: [{ text: "테스트", stress: "primary" }],
      engine_version: "cmudict-arpabet-hangul-render-v1",
      playback_enabled: true,
      display_enabled: true,
      identity_content_sha256: "A".repeat(64),
    };
    expect(
      parseVocabPronunciationIdentityV2(
        row,
        "https://wojxpruvbjzbhrpmsbuy.supabase.co",
      )?.audioUrl,
    ).toBe(
      `https://wojxpruvbjzbhrpmsbuy.supabase.co/storage/v1/object/public/vocab-pronunciation-audio/${row.storage_object_key}`,
    );
    const normalRateRow = {
      ...row,
      profile_id: "profile:1a77d56d47e26013",
      storage_object_key:
        `pronunciation/google_cloud_text_to_speech/profile-1a77d56d47e26013/ability-voca-etymology-2025-v1/${requestHash}.mp3`,
    };
    expect(
      parseVocabPronunciationIdentityV2(
        normalRateRow,
        "https://wojxpruvbjzbhrpmsbuy.supabase.co",
      )?.audioUrl,
    ).toBe(
      `https://wojxpruvbjzbhrpmsbuy.supabase.co/storage/v1/object/public/vocab-pronunciation-audio/${normalRateRow.storage_object_key}`,
    );
    expect(
      parseVocabPronunciationIdentityV2(
        { ...row, storage_object_key: "wrong.mp3" },
        "https://wojxpruvbjzbhrpmsbuy.supabase.co",
      ),
    ).toBeUndefined();
    expect(
      parseVocabPronunciationIdentityV2(
        {
          ...row,
          segments: [
            { text: "테", stress: "primary" },
            { text: "스트", stress: "primary" },
          ],
        },
        "https://wojxpruvbjzbhrpmsbuy.supabase.co",
      ),
    ).toBeUndefined();
  });

  it("모의고사 저장 발음 다음에 활성 VOCA 묶음을 사용한다", () => {
    const snapshot = parseTargetPronunciation({
      displayPronunciationKo: "시험 발음",
      pronunciationVariantId: "mw:exam",
      audioStatus: "raw_attached",
      audioUrl: officialUrl,
      listeningEnabled: true,
    });
    const activeVoca = {
      displayKo: "보카 발음",
      segments: [{ text: "보카 발음", stress: "primary" as const }],
      variantId: `mw:${"2".repeat(20)}`,
      audioUrl: officialUrl,
      available: true,
    };
    const legacy = { ...activeVoca, variantId: "mw:legacy" };
    expect(
      preferredPronunciationWithActiveVocaRelease(
        null,
        snapshot,
        activeVoca,
        legacy,
        undefined,
        new Map(),
      ).variantId,
    ).toBe("mw:exam");
    expect(
      preferredPronunciationWithActiveVocaRelease(
        null,
        parseTargetPronunciation({}),
        activeVoca,
        legacy,
        undefined,
        new Map(),
      ),
    ).toBe(activeVoca);
  });
});
