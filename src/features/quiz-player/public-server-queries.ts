import "server-only";
// Query-only boundary: importing the full server port would create a cycle
// through preparation -> attempt-query -> this reader.
export { getAttemptQuestionContents, getPreparationQuestionContents, getAssignmentStudyQuestionContents,
  getAdminWrongHistoryQuestionContents, type AttemptContentActor } from "./server/queries/question-content-query";
