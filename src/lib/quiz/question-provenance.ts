export type QuestionProvenanceStatus =
  | "legacy_backfill"
  | "verified_v2"
  | "reviewed_for_preview_v1";

export function isTrustedQuestionSnapshot(
  status: QuestionProvenanceStatus | null | undefined,
) {
  return (
    status === "verified_v2" || status === "reviewed_for_preview_v1"
  );
}
