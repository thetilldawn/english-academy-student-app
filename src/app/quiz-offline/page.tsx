import { LocalQuizPlayer } from "@/features/quiz-player/client/components/local-quiz-player";
export const dynamic = "error";
export const metadata = { title: "단어 시험" };
export default function OfflineQuizPage() { return <LocalQuizPlayer />; }
