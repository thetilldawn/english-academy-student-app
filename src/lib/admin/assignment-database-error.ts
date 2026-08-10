export type AssignmentDatabaseErrorLike = {
  code?: string;
  message?: string;
};

// Assignment writers reserve SQLSTATE 21000 for persistence and snapshot
// cardinality invariants. It is a server failure, not a teacher input error.
export function isAssignmentPersistenceInvariantFailure(
  error: AssignmentDatabaseErrorLike,
) {
  return error.code === "21000";
}
