"use client";
import { NotebookDetail } from "@/features/student-dashboard/client/components/notebook-detail";
import { Button } from "@/design-system/primitives/button/button";
export default function Error({ unstable_retry }: { unstable_retry: () => void }) {
  return <NotebookDetail presentation="intercepted"><p role="alert">단어를 불러오지 못했습니다. 다시 시도해 주세요.</p>
    <Button onClick={unstable_retry}>다시 시도</Button></NotebookDetail>;
}

