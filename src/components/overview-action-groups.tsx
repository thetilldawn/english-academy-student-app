import { AdminHistoryList } from "@/components/admin-history-list";
import { CountBadge } from "@/design-system/primitives/badge/badge";
import { adminOverviewText } from "@/content/ko/admin-overview";
import type { AssignmentHistorySummary } from "@/lib/admin/history";

type OverviewSection = {
  id: string;
  title: string;
  items: AssignmentHistorySummary[];
};

export function OverviewActionGroups({
  sections,
}: {
  sections: OverviewSection[];
}) {
  return (
    <div className="overview-action-groups">
      {sections.map((section) => (
        <section
          aria-labelledby={`overview-${section.id}`}
          className="overview-action-section"
          key={section.id}
        >
          <div className="section-heading">
            <h2 id={`overview-${section.id}`}>{section.title}</h2>
            <CountBadge>
              {section.items.length}{adminOverviewText.countSuffix}
            </CountBadge>
          </div>
          <AdminHistoryList compact items={section.items} />
        </section>
      ))}
    </div>
  );
}
