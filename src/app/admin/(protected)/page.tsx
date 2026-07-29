import type { Metadata } from "next";
import Link from "next/link";

import { formatKoreanDateTime } from "@/lib/format";
import {
  listAssignments,
  listAttempts,
  listDatasets,
  listStudents,
} from "@/lib/services/admin-service";

export const metadata: Metadata = {
  title: "Overview",
};

function attemptStatusText(status: "in_progress" | "completed" | "expired") {
  if (status === "completed") return "완료";
  if (status === "in_progress") return "응시 중";
  return "시간 종료";
}

export default async function AdminDashboardPage() {
  const [students, assignments, attempts, datasets] = await Promise.all([
    listStudents(),
    listAssignments(),
    listAttempts(),
    listDatasets(),
  ]);
  const activeStudents = students.filter(
    (student) => student.status === "active",
  ).length;
  const completedAttempts = attempts.filter(
    (attempt) => attempt.status === "completed",
  );
  const passedAttempts = completedAttempts.filter(
    (attempt) => attempt.passed,
  ).length;
  const readyDatasets = datasets.filter(
    (dataset) => dataset.status === "ready" && dataset.isActive,
  ).length;
  const passRate =
    completedAttempts.length === 0
      ? null
      : Math.round((passedAttempts / completedAttempts.length) * 100);

  return (
    <>
      <div className="page-heading admin-dashboard-heading">
        <div>
          <p className="eyebrow">OVERVIEW</p>
          <h1>Overview</h1>
          <p>최근 시험 결과와 지금 관리할 항목을 한 화면에서 봅니다.</p>
        </div>
        <Link className="button button-primary" href="/admin/assignments">
          단어 시험 배정
        </Link>
      </div>

      <div className="admin-dashboard-layout">
        <section
          aria-labelledby="recent-activity-heading"
          className="card admin-activity-panel"
        >
          <div className="section-heading">
            <h2 id="recent-activity-heading">최근 응시</h2>
            <Link className="nav-link" href="/admin/results">
              전체 내역 →
            </Link>
          </div>
          {attempts.length === 0 ? (
            <div className="empty-state">아직 응시 기록이 없습니다.</div>
          ) : (
            <ol className="activity-list">
              {attempts.slice(0, 8).map((attempt) => (
                <li className="activity-row" key={attempt.id}>
                  <Link
                    className="activity-link"
                    href={`/admin/results/${attempt.id}`}
                  >
                    <span className="activity-marker" aria-hidden="true" />
                    <span className="activity-copy">
                      <strong>{attempt.studentName}</strong>
                      <span>{attempt.assignmentTitle}</span>
                      <small>
                        시작 {formatKoreanDateTime(attempt.startedAt)}
                        {attempt.completedAt
                          ? ` · 종료 ${formatKoreanDateTime(
                              attempt.completedAt,
                            )}`
                          : ""}
                      </small>
                      {attempt.initialCorrectCount !== null && (
                        <small>
                          첫 시험 정답 {attempt.initialCorrectCount}/
                          {attempt.questionCount}
                          {" · "}한 번 틀린 단어{" "}
                          {attempt.retryCorrectCount ?? 0}
                          {" · "}다시 볼 단어{" "}
                          {attempt.unresolvedWrongCount ?? 0}
                        </small>
                      )}
                    </span>
                    <span
                      className={`status-pill status-${attempt.status}`}
                    >
                      {attempt.status === "completed"
                        ? `${attempt.initialScore ?? "-"}점`
                        : attemptStatusText(attempt.status)}
                    </span>
                  </Link>
                </li>
              ))}
            </ol>
          )}
        </section>

        <aside
          aria-labelledby="quick-overview-heading"
          className="admin-quick-panel"
        >
          <div className="section-heading">
            <h2 id="quick-overview-heading">관리 요약</h2>
          </div>
          <div className="quick-metrics">
            <article className="card metric">
              <span className="metric-value">{activeStudents}</span>
              <span className="metric-label">
                접속 가능 / 전체 {students.length}명
              </span>
            </article>
            <article className="card metric">
              <span className="metric-value">{assignments.length}</span>
              <span className="metric-label">배정한 시험</span>
            </article>
            <article className="card metric">
              <span className="metric-value">
                {passRate === null ? "-" : `${passRate}%`}
              </span>
              <span className="metric-label">완료 시험 통과율</span>
            </article>
            <article className="card metric">
              <span className="metric-value">{readyDatasets}</span>
              <span className="metric-label">사용 가능 어휘목록</span>
            </article>
          </div>

          {readyDatasets === 0 && (
            <div className="notice notice-warm">
              최신 능률보카 목록을 가져오면 시험 배정이 열립니다.
            </div>
          )}
        </aside>
      </div>
    </>
  );
}
