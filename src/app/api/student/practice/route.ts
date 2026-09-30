import { handlePracticeRequest } from "@/features/quiz-player/public-server";
const handle = (request: Request) => handlePracticeRequest(request, { params: Promise.resolve({}) });
export const GET = handle;
export const POST = handle;
