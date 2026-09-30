import { NotebookDetail } from "@/features/student-dashboard/client/components/notebook-detail";
import { ButtonLink } from "@/design-system/primitives/button/button";
export default function NotFound() { return <NotebookDetail presentation="intercepted"><p>단어를 찾을 수 없습니다.</p><ButtonLink href="/student/wordbook" prefetch={false}>내 단어장</ButtonLink></NotebookDetail>; }

