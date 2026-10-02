"use client";
import { useCallback, useLayoutEffect, useRef, useState } from "react";
import type { DatasetOption } from "@/lib/admin/dataset-summary";
import type { AssignmentDatasetItem } from "../catalog-types";
import { loadAssignmentDatasetDirectory } from "../transport/assignment-workspace-reads";
import { useAssignmentAuthenticationFailure } from "./assignment-authentication-boundary";

export type RefreshDatasetMetadata = (signal: AbortSignal) => Promise<DatasetOption[]>;
const loadMetadata: RefreshDatasetMetadata = async signal => (await loadAssignmentDatasetDirectory(signal)).datasets;
const displayFields = (d: DatasetOption) => ({
  title: d.title, displayName: d.displayName, edition: d.edition, catalogGroup: d.catalogGroup,
  materialKind: d.materialKind, gradeCode: d.gradeCode, publisher: d.publisher, seriesTitle: d.seriesTitle,
  academicYear: d.academicYear, curriculumRevision: d.curriculumRevision, editionLabel: d.editionLabel,
  catalogSortIndex: d.catalogSortIndex, schoolName: d.schoolName, schoolClassification: d.schoolClassification,
  purpose: d.purpose, semester: d.semester, ...(Object.hasOwn(d, "templateKind") ? { templateKind: d.templateKind } : {}),
});

// Display refresh never enters the planner reducer or replaces question availability.
export function useAssignmentDatasetMetadata(datasets: readonly AssignmentDatasetItem[], enabled: boolean, refresh: RefreshDatasetMetadata = loadMetadata) {
  const [overrides, setOverrides] = useState<Record<string, ReturnType<typeof displayFields>>>({});
  const request = useRef<AbortController | null>(null);
  const allowed = useRef(enabled);
  const captureFailure = useAssignmentAuthenticationFailure();
  useLayoutEffect(() => {
    allowed.current = enabled;
    if (!enabled) request.current?.abort();
    return () => { allowed.current = false; request.current?.abort(); };
  }, [enabled]);
  const refreshMetadata = useCallback(async () => {
    if (!allowed.current) throw new DOMException("Inactive", "AbortError");
    request.current?.abort(); const current = new AbortController(); request.current = current;
    const reportFailure = captureFailure();
    try {
      const fresh = await refresh(current.signal);
      current.signal.throwIfAborted();
      if (!allowed.current || request.current !== current) throw new DOMException("Superseded", "AbortError");
      setOverrides(Object.fromEntries(fresh.map(d => [d.id, displayFields(d)])));
    } catch (error) {
      if (allowed.current && !current.signal.aborted && request.current === current) reportFailure(error);
      throw error;
    }
  }, [refresh, captureFailure]);
  return { datasets: datasets.map(d => ({ ...d, ...overrides[d.id] })), refreshMetadata };
}
