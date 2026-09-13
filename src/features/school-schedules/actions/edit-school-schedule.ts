"use server";

import { refresh as refreshRouter } from "next/cache";

import {
  readSchoolScheduleEditorAction as read,
  saveSchoolScheduleEventAction as save,
  readSchoolScheduleSaveResultAction as recover,
  refreshSchoolScheduleOverviewAction as refresh,
} from "../server/actions/school-schedule-edit-actions";

export async function readSchoolScheduleEditorAction(input: unknown) { return read(input); }
export async function saveSchoolScheduleEventAction(input: unknown) {
  const result = await save(input);
  if (result.ok) refreshRouter();
  return result;
}
export async function readSchoolScheduleSaveResultAction(input: unknown) {
  const result = await recover(input);
  if (result.ok && result.receipt) refreshRouter();
  return result;
}
export async function refreshSchoolScheduleOverviewAction() { return refresh(); }
