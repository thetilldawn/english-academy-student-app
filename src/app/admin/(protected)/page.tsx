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
  title: "관리 현황",
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
          <h1>수업 현황</h1>
          <p>최근 응시 흐름과 지금 확인할 수치를 함께 봅니다.</p>
        </div>
        <Link className="button button-primary" href="/admin/assignments">
          새 시험 배정
        </Link>
      </div>

      <div className="admin-dashboard-layout">
        <section
          aria-labelledby="recent-activity-heading"
          className="card admin-activity-panel"
        >
          <div className="section-heading">
            <h2 id="recent-activity-heading">최근 응시 흐름</h2>
            <Link className="nav-link" href="/admin/results">
              전체 결과 →
            </Link>
          </div>
          {attempts.length === 0 ? (
            <div className="empty-state">아직 응시 기록이 없습니다.</div>
          ) : (
            <ol className="activity-list">
              {attempts.slice(0, 8).map((attempt) => (
                <li className="activity-row" key={attempt.id}>
                  <span className="activity-marker" aria-hidden="true" />
                  <span className="activity-copy">
                    <strong>{attempt.studentName}</strong>
                    <span>{attempt.assignmentTitle}</span>
                    <small>{formatKoreanDateTime(attempt.startedAt)}</small>
                  </span>
                  <span
                    className={`status-pill status-${attempt.status}`}
                  >
                    {attempt.status === "completed"
                      ? `${attempt.initialScore ?? "-"}점`
                      : attemptStatusText(attempt.status)}
                  </span>
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
            <h2 id="quick-overview-heading">빠른 확인</h2>
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
