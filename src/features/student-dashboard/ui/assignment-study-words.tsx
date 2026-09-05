"use client";

import { PronunciationText } from "@/components/pronunciation-text";
import { studentAppText } from "@/content/ko/student-app";
import { AudioButton } from "@/design-system/patterns/audio-button/audio-button";
import type { AssignmentStudy } from "../contracts/assignment-study";
import { useStudyAudio } from "../controller/use-study-audio";
import styles from "./assignment-study.module.css";

export function AssignmentStudyWords({ study }: { study: AssignmentStudy }) {
  const { failedWord, play } = useStudyAudio();
  const text = studentAppText.study;
  return (
    <>
      <p className={styles.summary}>{study.words.length}{text.countSuffix}</p>
      <ul className={styles.words} aria-label={text.listLabel}>
        {study.words.map((word) => {
          const audioUrl = word.pronunciation.available ? word.pronunciation.audioUrl : null;
          return (
            <li className={styles.word} key={word.key}>
              <div className={styles.wordTop}>
                <h3 className={styles.headword} lang="en">{word.headword}</h3>
                <AudioButton
                  disabled={!audioUrl}
                  label={`${word.headword} ${text.pronunciationLabel}`}
                  onClick={() => { if (audioUrl) void play(word.key, audioUrl); }}
                  variant="compact"
                />
              </div>
              <PronunciationText className={styles.pronunciation} pronunciation={word.pronunciation} />
              {!word.pronunciation.displayKo && !audioUrl ? <p className={styles.notice}>{text.audioUnavailable}</p> : null}
              {!audioUrl && word.pronunciation.displayKo ? <p className={styles.notice}>{text.soundUnavailable}</p> : null}
              {failedWord === word.key ? <p className={styles.notice} role="alert">{text.audioError}</p> : null}
              <p className={styles.meaning}>{word.meaning}</p>
              {study.mode === "canonical_definition_to_headword" ? (
                <div className={styles.context}><span>{text.definition}</span><p lang={word.definition ? "en" : "ko"}>{word.definition ?? text.contextUnavailable}</p></div>
              ) : null}
              {study.mode === "canonical_example_to_headword" ? (
                <div className={styles.context}><span>{text.example}</span><p lang={word.example ? "en" : "ko"}>{word.example ?? text.contextUnavailable}</p></div>
              ) : null}
            </li>
          );
        })}
      </ul>
    </>
  );
}
