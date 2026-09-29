"use client";

import { ResultLoadError } from "@/features/results/ui/result-load-error";

export default function StudentResultError({ unstable_retry }: { unstable_retry: () => void }) {
  return <ResultLoadError retry={unstable_retry} />;
}
