import type { QuizPronunciation } from "@/lib/quiz/pronunciation-snapshot";

export function PronunciationText({
  className,
  pronunciation,
}: {
  className?: string;
  pronunciation: QuizPronunciation;
}) {
  if (!pronunciation.displayKo) return null;

  return (
    <small className={className} data-pronunciation-text>
      <span aria-hidden="true">[</span>
      {pronunciation.segments?.length
        ? pronunciation.segments.map((segment, index) =>
            segment.stress === "primary" ? (
              <strong
                data-stress="primary"
                key={`${segment.text}:${index}`}
              >
                {segment.text}
              </strong>
            ) : segment.stress === "secondary" ? (
              <em
                data-stress="secondary"
                key={`${segment.text}:${index}`}
              >
                {segment.text}
              </em>
            ) : (
              <span data-stress="none" key={`${segment.text}:${index}`}>
                {segment.text}
              </span>
            ),
          )
        : pronunciation.displayKo}
      <span aria-hidden="true">]</span>
    </small>
  );
}
