import type { Metadata } from "next";
import Link from "next/link";

import { AdminHistoryList } from "@/components/admin-history-list";
import { listAssignmentHistory } from "@/lib/services/admin-service";

export const metadata: Metadata = {
  title: "Overview",
};

export default async function AdminDashboardPage() {
  const history = await listAssignmentHistory();

  return (
    <>
      <div className="page-heading admin-page-heading admin-dashboard-heading">
        <div>
          <p className="eyebrow">OVERVIEW</p>
          <h1>Overview</h1>
          <p>최근 배정과 응시 여부, 첫 시험·최종 점수를 확인합니다.</p>
        </div>
        <Link className="button button-primary" href="/admin/assignments">
          단어 시험 배정
        </Link>
      </div>

      <section aria-labelledby="recent-activity-heading">
        <div className="section-heading">
          <h2 id="recent-activity-heading">최근 시험</h2>
          <Link className="nav-link" href="/admin/results">
            전체 내역 →
          </Link>
        </div>
        <AdminHistoryList compact items={history.slice(0, 8)} />
      </section>
    </>
  );
}
