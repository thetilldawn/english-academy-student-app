import type { ReactNode } from "react";
import { NotebookWorkspace } from "@/features/student-dashboard/client/components/notebook-detail";
import { requireStudentSession } from "@/lib/auth/student-session";
import { studentNotebookCacheIdentity } from "@/lib/auth/private-cache-identity";
export default async function Layout({ children, detail }: { children: ReactNode; detail: ReactNode }) {
  const identity = studentNotebookCacheIdentity(await requireStudentSession());
  return <NotebookWorkspace key={identity} identity={identity} detail={detail}>{children}</NotebookWorkspace>;
}

