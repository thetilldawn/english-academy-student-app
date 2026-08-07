export type BookMeaningCapabilityStatus = "ready" | "limited" | "blocked";

export function resolveBookMeaningCapability(
  eligibleEntryCount: number,
  excludedEntryCount: number,
  limitedReasonCode: string,
): { status: BookMeaningCapabilityStatus; reasonCode: string } {
  if (
    !Number.isInteger(eligibleEntryCount) ||
    !Number.isInteger(excludedEntryCount) ||
    eligibleEntryCount < 0 ||
    excludedEntryCount < 0 ||
    eligibleEntryCount + excludedEntryCount === 0
  ) {
    throw new Error("invalid_vocab_capability_counts");
  }

  if (eligibleEntryCount === 0) {
    return { status: "blocked", reasonCode: limitedReasonCode };
  }
  if (excludedEntryCount === 0) {
    return { status: "ready", reasonCode: "all_entries_eligible" };
  }
  return { status: "limited", reasonCode: limitedReasonCode };
}
