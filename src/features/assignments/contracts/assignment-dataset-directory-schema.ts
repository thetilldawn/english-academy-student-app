import { z } from "zod";
import { DATASET_CATALOG_GROUPS } from "@/lib/admin/dataset-catalog";

// Validate the existing directory contract before an empty response becomes a successful empty list.
export const assignmentDatasetDirectorySchema = z.object({
  datasets: z.array(z.object({
    id: z.string().min(1), title: z.string(), edition: z.string().nullable(),
    displayName: z.string(), catalogGroup: z.enum(DATASET_CATALOG_GROUPS),
    materialKind: z.enum(["textbook", "wordbook", "exam_collection", "exam_prep", "supplement"]).nullable(),
    gradeCode: z.string().nullable(), publisher: z.string().nullable(), seriesTitle: z.string().nullable(),
    academicYear: z.number().nullable(), curriculumRevision: z.string().nullable(), editionLabel: z.string().nullable(),
    isAssignable: z.boolean(), catalogSortIndex: z.number(),
    schoolName: z.string().trim().min(1).max(120).nullable().optional(),
    schoolClassification: z.enum(["school", "common", "unclassified"]).optional(),
    purpose: z.literal("exam_prep").nullable().optional(),
    semester: z.union([z.literal(1), z.literal(2)]).nullable().optional(),
  })),
});
