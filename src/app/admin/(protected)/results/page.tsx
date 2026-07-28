import type { Metadata } from "next";
import Link from "next/link";

import { formatKoreanDateTime } from "@/lib/format";
import { listAttempts } from "@/lib/services/admin-service";

export const metadata: Metadata = {
  title: "시험 결과",
};

export default async function ResultsPage() {
  const attempts = await listAttempts();

  return (
    <>
      <div className="page-heading">
        <div>
          <p className="eyebrow">RESULTS</p>
          <h1 id="results-heading">시험 결과</h1>
          <p>첫 점수와 재풀이 후 점수를 나눠 확인합니다.</p>
        </div>
      </div>

      {attempts.length === 0 ? (
        <div className="empty-state">아직 응시 기록이 없습니다.</div>
      ) : (
        <>
          <p className="table-scroll-hint">
            표를 좌우로 움직이면 모든 결과 항목을 확인할 수 있습니다.
          </p>
          <div
            aria-labelledby="results-heading"
            className="table-wrap results-table-wrap"
            role="region"
            tabIndex={0}
          >
          <table className="results-table">
            <caption className="sr-only">
              학생별 단어시험 응시 결과
            </caption>
            <thead>
              <tr>
                <th scope="col">학생</th>
                <th scope="col">시험</th>
                <th scope="col">회차</th>
                <th scope="col">상태</th>
                <th scope="col">첫 점수</th>
                <th scope="col">재풀이 후</th>
                <th scope="col">통과</th>
                <th scope="col">시작</th>
              </tr>
            </thead>
            <tbody>
              {attempts.map((attempt) => (
                <tr key={attempt.id}>
                  <td>{attempt.studentName}</td>
                  <td>
                    <Link
                      className="table-link"
                      href={`/admin/results/${attempt.id}`}
                    >
                      {attempt.assignmentTitle}
                    </Link>
                  </td>
                  <td>{attempt.attemptNumber}</td>
                  <td>
                    <span
                      className={`status-pill status-${attempt.status}`}
                    >
                      {attempt.status === "completed"
                        ? "완료"
                        : attempt.status === "in_progress"
                          ? "응시 중"
                          : "시간 종료"}
                    </span>
                  </td>
                  <td>
                    {attempt.initialScore === null
                      ? "-"
                      : `${attempt.initialScore}점`}
                  </td>
                  <td>
                    {attempt.finalScore === null
                      ? "-"
                      : `${attempt.finalScore}점`}
                  </td>
                  <td>
                    {attempt.passed === null
                      ? "-"
                      : attempt.passed
                        ? "통과"
                        : "미통과"}
                  </td>
                  <td>{formatKoreanDateTime(attempt.startedAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          </div>
        </>
      )}
    </>
  );
}
