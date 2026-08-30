import type {
  StudentDirectoryFilters,
  StudentDirectorySnapshot,
} from "@/features/students/public-contracts";
import type { AssignmentEditDraft } from "@/lib/admin/assignment-edit";
import type { DatasetOption } from "@/lib/admin/dataset-summary";

import type {
  AssignmentDatasetItem,
  AssignmentStudentItem,
  AssignmentUnitItem,
} from "../catalog-types";
import type { PreviousVocabExamSource } from "../domain/vocab-previous-exam";
import type { VocabTimeTemplateRecord } from "./vocab-time-template-contract";

export type AssignmentSelectionStudent = {
  currentVocabBook: string | null;
  displayName: string;
  gradeLabel: string | null;
  id: string;
  schoolName: string | null;
};

export type AssignmentWorkspaceInitial = {
  directory: StudentDirectorySnapshot;
};

export type AssignmentDirectorySelectionRequest = {
  filters: StudentDirectoryFilters;
  snapshotAt: string;
};

export type AssignmentDirectorySelectionResponse = {
  students: AssignmentSelectionStudent[];
  totalCount: number;
};

export type AssignmentPlannerPreparation = {
  datasets: AssignmentDatasetItem[];
  initialDatasetId: string;
  initialUnits: AssignmentUnitItem[];
  students: AssignmentStudentItem[];
  timeTemplates: VocabTimeTemplateRecord[];
};

export type AssignmentPreviousExamResponse = {
  previousExam: PreviousVocabExamSource | null;
};

export type AssignmentDatasetUnitsResponse = {
  datasetId: string;
  units: AssignmentUnitItem[];
};

export type AssignmentDatasetDirectoryResponse = {
  datasets: DatasetOption[];
};

export type AssignmentEditContext = {
  datasets: AssignmentDatasetItem[];
  initialEditDraft: AssignmentEditDraft;
  initialDatasetId: string;
  initialUnitIds: string[];
  progress: null;
  student: AssignmentStudentItem;
  units: AssignmentUnitItem[];
};
