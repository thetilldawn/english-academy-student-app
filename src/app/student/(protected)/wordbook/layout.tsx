import type { ReactNode } from "react";
import { NotebookWorkspace } from "@/features/student-dashboard/client/components/notebook-detail";
export default function Layout({ children, detail }: { children: ReactNode; detail: ReactNode }) {
  return <NotebookWorkspace detail={detail}>{children}</NotebookWorkspace>;
}

