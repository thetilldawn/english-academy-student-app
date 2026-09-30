import { handlePracticeRequest } from "@/features/quiz-player/public-server";
export const POST = (request: Request) => handlePracticeRequest(request, { params: Promise.resolve({}) }, "preview");
