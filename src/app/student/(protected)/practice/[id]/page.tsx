import { PracticeContent } from "@/features/quiz-player/server/components/practice-content";
export const metadata = { title: "자율연습" };
export default function Page({ params }: { params: Promise<{ id: string }> }) { return <PracticeContent params={params} />; }
