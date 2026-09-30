import { expireQuizAttempt, recoverQuizAttempt, resumeQuizAfterFeedback, submitQuizAnswer } from "./quiz-attempt";

export type QuizTransport = {
  answer: (input: Parameters<typeof submitQuizAnswer>[0]) => ReturnType<typeof submitQuizAnswer>;
  read: (id: string) => ReturnType<typeof recoverQuizAttempt>;
  feedback: (input: Parameters<typeof resumeQuizAfterFeedback>[0]) => ReturnType<typeof resumeQuizAfterFeedback>;
  expire: (id: string) => ReturnType<typeof expireQuizAttempt>;
  resultHref: (id: string) => string;
};
export const regularQuizTransport: QuizTransport = {
  answer: input => submitQuizAnswer(input), read: id => recoverQuizAttempt(id),
  feedback: input => resumeQuizAfterFeedback(input), expire: id => expireQuizAttempt(id),
  resultHref: id => `/student/result/${id}`,
};
export const practiceQuizTransport: QuizTransport = {
  answer: input => submitQuizAnswer(input, "/api/student/practice"), read: id => recoverQuizAttempt(id, "/api/student/practice"),
  feedback: input => resumeQuizAfterFeedback(input, "/api/student/practice"), expire: id => expireQuizAttempt(id, "/api/student/practice"),
  resultHref: id => `/student/practice/${id}/result`,
};
