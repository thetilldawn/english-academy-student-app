import { PronunciationText } from "@/components/pronunciation-text";
import { studentAppText } from "@/content/ko/student-app";
import { AudioButton } from "@/design-system/patterns/audio-button/audio-button";
import type { AssignmentStudy } from "../contracts/assignment-study";
import { splitStudyExample } from "../domain/study-example-ranges";
import { StudyBlur } from "./study-blur";
import styles from "./assignment-study.module.css";

export function AssignmentStudyWords({ study, englishHidden, meaningHidden, failedWord, onPlay }: {
  study: AssignmentStudy;
  englishHidden: boolean;
  meaningHidden: boolean;
  failedWord: string | null;
  onPlay: (key: string, url: string) => Promise<void>;
}) {
  const text = studentAppText.study;
  return (
    <>
      <p className={styles.summary}>{study.words.length}{text.countSuffix}</p>
      <ul className={styles.words} aria-label={text.listLabel}>
        {study.words.map((word) => {
          const audioUrl = word.pronunciation.available ? word.pronunciation.audioUrl : null;
          const exampleParts = word.example ? splitStudyExample(word.example, word.exampleRanges) : null;
          return (
            <li className={styles.word} key={word.key}>
              {(study.mode === "canonical_definition_to_headword" || study.mode === "canonical_headword_to_definition") ? <div className={styles.context}>
                <span>{text.definition}</span><p lang={word.definition ? "en" : "ko"}>{word.definition ?? text.contextUnavailable}</p>
              </div> : null}
              {study.mode === "canonical_example_to_headword" ? <div className={styles.context}>
                <span>{text.example}</span>
                <p lang={word.example ? "en" : "ko"}>{!word.example ? text.contextUnavailable : exampleParts ? exampleParts.map((part) =>
                  part.concealed ? <StudyBlur key={part.start} concealed={englishHidden} label={text.exampleWordHidden}>{part.text}</StudyBlur> : part.text
                ) : <StudyBlur concealed={englishHidden} label={text.examplePositionUnavailable}>{word.example}</StudyBlur>}</p>
                {word.example && !exampleParts ? <p className={styles.notice}>{text.examplePositionUnavailable}</p> : null}
              </div> : null}
              <div className={study.mode === "book_meaning_choice" ? styles.columns : styles.englishOnly}>
                <StudyBlur block concealed={englishHidden} label={text.englishHidden}>
                  <div className={styles.wordTop}>
                    <h3 className={styles.headword} lang="en">{word.headword}</h3>
                    <AudioButton disabled={!audioUrl || englishHidden}
                      label={`${word.headword} ${text.pronunciationLabel}`}
                      onClick={() => { if (audioUrl && !englishHidden) void onPlay(word.key, audioUrl); }} variant="compact" />
                  </div>
                  <PronunciationText className={styles.pronunciation} pronunciation={word.pronunciation} />
                  {!word.pronunciation.displayKo && !audioUrl ? <p className={styles.notice}>{text.audioUnavailable}</p> : null}
                  {!audioUrl && word.pronunciation.displayKo ? <p className={styles.notice}>{text.soundUnavailable}</p> : null}
                </StudyBlur>
                {study.mode === "book_meaning_choice" ? <StudyBlur block concealed={meaningHidden} label={text.meaningHidden}>
                  <p className={styles.meaning}>{word.meaning}</p>
                </StudyBlur> : null}
              </div>
              {!englishHidden && failedWord === word.key ? <p className={styles.notice} role="alert">{text.audioError}</p> : null}
            </li>
          );
        })}
      </ul>
    </>
  );
}
