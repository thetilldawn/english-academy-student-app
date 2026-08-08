export const readingCurriculumStages = [
  "undecided",
  "yeongminjeongeum_foundation",
  "yeongminjeongeum_foundation_advanced",
  "yeongminjeongeum_foundation_complete",
  "yeongminjeongeum_basic",
] as const;

export type ReadingCurriculumStage =
  (typeof readingCurriculumStages)[number];

export const READING_CURRICULUM_LABELS: Record<
  ReadingCurriculumStage,
  string
> = {
  undecided: "미정",
  yeongminjeongeum_foundation: "영민정음 기초",
  yeongminjeongeum_foundation_advanced: "영민정음 기초 심화",
  yeongminjeongeum_foundation_complete: "영민정음 기초 완성",
  yeongminjeongeum_basic: "영민정음 기본",
};

export function readingCurriculumStageLabel(
  stage: ReadingCurriculumStage,
) {
  return READING_CURRICULUM_LABELS[stage];
}
