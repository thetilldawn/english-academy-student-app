import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import {
  formatElapsed,
  formatKoreanDateTime,
} from "@/lib/format";
import { getResultQuestionPresentation } from "@/lib/quiz/result-presentation";
import { getAdminAttemptDetail } from "@/lib/services/admin-service";

export const metadata: Metadata = {
  title: "응시 상세",
};

function retryLabel(
  initialIsCorrect: boolean | null,
  retryIsCorrect: boolean | null,
  reviewPending: boolean,
) {
  if (initialIsCorrect === true) return "첫 시험 정답";
  if (retryIsCorrect === true) return "한 번 틀린 단어";
  if (retryIsCorrect === false) return "다시 볼 단어";
  if (reviewPending) return "재시험 전";
  return "미완료";
}

export default async function AdminResultDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const result = await getAdminAttemptDetail(id);
  if (!result) notFound();
  const reviewPending =
    result.status === "in_progress" && result.phase === "review";

  const wrongQuestions = result.questions.filter(
    (question) => question.initialIsCorrect !== true,
  );

  return (
    <>
      <div className="page-heading">
        <div>
          <p className="eyebrow">ATTEMPT DETAIL</p>
          <h1>{result.studentName}</h1>
          <p>
            {result.assignmentTitle} · {result.attemptNumber}회 ·{" "}
            {formatKoreanDateTime(result.startedAt)}
          </p>
        </div>
        <Link className="button button-quiet" href="/admin/results">
          결과 목록
        </Link>
      </div>

      <div className="attempt-detail-layout">
        <aside aria-label="응시 요약" className="card attempt-summary">
          <h2>응시 요약</h2>
          <dl>
            <div>
              <dt>첫 시험 점수</dt>
              <dd>
                {result.initialScore === null
                  ? "-"
                  : `${result.initialScore}점`}
              </dd>
            </div>
            <div>
              <dt>최종 점수</dt>
              <dd>
                {result.finalScore === null ? "-" : `${result.finalScore}점`}
              </dd>
            </div>
            <div>
              <dt>미해결</dt>
              <dd>{result.unresolvedWrongCount ?? "-"}개</dd>
            </div>
            <div>
              <dt>응시 시간</dt>
              <dd>{formatElapsed(result.elapsedSeconds)}</dd>
            </div>
          </dl>
          <Link className="button button-quiet" href="/admin/results">
            결과 목록으로
          </Link>
        </aside>

        <section
          aria-labelledby="answer-flow-heading"
          className="attempt-flow-section"
        >
          <div className="section-heading">
            <h2 id="answer-flow-heading">첫 시험부터 재시험까지</h2>
            <span className="detail-chip">
              {wrongQuestions.length}문항
            </span>
          </div>

          {wrongQuestions.length === 0 ? (
            <div className="empty-state">
              첫 시험에서 모두 맞혔습니다.
            </div>
          ) : (
            <div className="attempt-flow-list">
              {wrongQuestions.map((question) => {
                const resolved = question.retryIsCorrect === true;
                const presentation =
                  getResultQuestionPresentation(question);

                return (
                  <article className="card attempt-flow-card" key={question.id}>
                    <div className="title-with-status">
                      <div>
                        <p className="eyebrow">문항 {question.orderIndex}</p>
                        <h3>{presentation.prompt}</h3>
                      </div>
                      <span
                        className={`status-pill ${
                          resolved
                            ? "status-completed"
                            : reviewPending
                              ? "status-in_progress"
                              : "status-expired"
                        }`}
                      >
                        {retryLabel(
                          question.initialIsCorrect,
                          question.retryIsCorrect,
                          reviewPending,
                        )}
                      </span>
                    </div>

                    <div
                      className={`answer-flow${
                        resolved ? " answer-flow-resolved" : ""
                      }`}
                    >
                      <div className="flow-step flow-step-wrong">
                        <span>첫 선택</span>
                        <strong>
                          {question.initialChoice ?? "선택 안 함"}
                        </strong>
                      </div>
                      <span className="flow-arrow" aria-hidden="true">
                        →
                      </span>
                      <div
                        className={[
                          "flow-step",
                          resolved
                            ? "flow-step-correct"
                            : "flow-step-wrong",
                        ].join(" ")}
                      >
                        <span>재시험</span>
                        <strong>
                          {question.retryChoice ??
                            (reviewPending ? "재시험 전" : "선택 안 함")}
                        </strong>
                        {resolved && (
                          <span className="sr-only">
                            재시험에서 맞힘
                          </span>
                        )}
                      </div>
                      {!resolved && (
                        <>
                          <span className="flow-arrow" aria-hidden="true">
                            →
                          </span>
                          <div className="flow-step flow-step-answer">
                            <span>정답</span>
                            <strong>{presentation.correctAnswer}</strong>
                          </div>
                        </>
                      )}
                    </div>
                  </article>
                );
              })}
            </div>
          )}
        </section>
      </div>
    </>
  );
}
