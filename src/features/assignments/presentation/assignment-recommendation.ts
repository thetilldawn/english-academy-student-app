import { formatContentText } from "@/content/format";
import { adminLearningText } from "@/content/ko/admin-learning";

import type { AssignmentProgressItem } from "../catalog-types";

export function assignmentRecommendationLabel(
  progress: AssignmentProgressItem | null,
) {
  if (!progress) return adminLearningText.recommendation.needsWordbook;
  if (progress.recommendationReason === "complete") {
    return adminLearningText.recommendation.complete;
  }
  if (progress.recommendationReason === "assigned") {
    return formatContentText(adminLearningText.recommendation.labels.missed, {
      range:
        progress.recommendedUnitLabel ??
        adminLearningText.recommendation.assignedFallback,
    });
  }
  if (progress.recommendationReason === "resume") {
    return formatContentText(adminLearningText.recommendation.labels.resume, {
      range:
        progress.recommendedUnitLabel ??
        adminLearningText.recommendation.recentFallback,
    });
  }
  if (progress.recommendationReason === "repeat") {
    return formatContentText(adminLearningText.recommendation.labels.repeat, {
      range:
        progress.recommendedUnitLabel ??
        adminLearningText.recommendation.recentFallback,
    });
  }
  if (progress.recommendationReason === "manual") {
    return adminLearningText.recommendation.manual;
  }
  return (
    progress.recommendedUnitLabel ??
    adminLearningText.recommendation.firstFallback
  );
}

export function assignmentRecommendationReasonLabel(
  progress: AssignmentProgressItem | null,
) {
  if (!progress) return adminLearningText.recommendation.reasons.needsWordbook;
  const reason = progress.recommendationReason;
  if (reason === "assigned") return adminLearningText.recommendation.reasons.assigned;
  if (reason === "resume") return adminLearningText.recommendation.reasons.resume;
  if (reason === "repeat") return adminLearningText.recommendation.reasons.repeat;
  if (reason === "next") return adminLearningText.recommendation.reasons.next;
  if (reason === "first") return adminLearningText.recommendation.reasons.first;
  if (reason === "complete") return adminLearningText.recommendation.reasons.complete;
  return adminLearningText.recommendation.reasons.manual;
}
