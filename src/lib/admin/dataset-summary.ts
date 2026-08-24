import type {
  CataloguedDataset,
  CataloguedUnit,
} from "@/lib/admin/dataset-catalog";

export type DatasetSummary = CataloguedDataset & {
  datasetKey: string;
  rowCount: number;
  status: "pending_review" | "ready" | "retired";
  isActive: boolean;
};

export type ReviewDatasetSummary = {
  id: string;
  title: string;
  edition: string | null;
  rowCount: number;
  visibleEntryCount: number;
  entries: {
    id: number;
    sourceRow: number;
    headword: string;
    primaryMeaning: string;
  }[];
};

export type DatasetOption = CataloguedDataset;

export type VocabUnitSummary = CataloguedUnit & {
  id: string;
  datasetId: string;
  label: string;
  kind: "day" | "supplement";
  number: number | null;
  sortIndex: number;
  entryCount: number;
};
