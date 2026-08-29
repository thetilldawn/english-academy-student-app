"use client";

import { useState } from "react";

export type StudentDetailTab = "info" | "account" | "history";

export function useStudentDetailView() {
  const [tab, setTab] = useState<StudentDetailTab>("info");
  const [historyVisited, setHistoryVisited] = useState(false);

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
