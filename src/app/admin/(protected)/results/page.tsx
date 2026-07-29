import type { Metadata } from "next";

import { AdminHistoryList } from "@/components/admin-history-list";
import { listAssignmentHistory } from "@/lib/services/admin-service";

export const metadata: Metadata = {
  title: "내역",
};

export default async function ResultsPage() {
  const history = await listAssignmentHistory();

  return (
    <>
      <div className="page-heading admin-page-heading">
        <div>
          <p className="eyebrow">HISTORY</p>
          <h1 id="results-heading">내역</h1>
          <p>
            미응시 배정부터 완료 시험까지 학생별 상태와 점수를
            확인합니다.
          </p>
        </div>
      </div>
      <AdminHistoryList items={history} showFilters />
    </>
  );
}
