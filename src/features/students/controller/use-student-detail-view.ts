"use client";

import { useState } from "react";

export type StudentDetailTab = "info" | "account" | "history";

export function useStudentDetailView(initialTab: StudentDetailTab = "info") {
  const [tab, setTab] = useState<StudentDetailTab>(initialTab);
  const [historyVisited, setHistoryVisited] = useState(initialTab === "history");

  function changeTab(nextTab: StudentDetailTab) {
    setTab(nextTab);
    if (nextTab === "history") setHistoryVisited(true);
  }

  return {
    historyVisited,
    tab,
    actions: { changeTab },
  };
}
