import { PracticeContent } from "@/features/quiz-player/server/components/practice-content";
export const metadata = { title: "연습 결과" };
export default function Page({ params }: { params: Promise<{ id: string }> }) { return <PracticeContent params={params} result />; }
