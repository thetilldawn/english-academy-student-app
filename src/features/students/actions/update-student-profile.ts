"use server";

import type { StudentProfileActionResult } from "../contracts/student-mutation-result";
import { readStudentProfileSaveResultAction, updateStudentProfileAction } from "../server/actions/update-student-profile-action";

export async function updateStudentProfile(
  input: unknown,
): Promise<StudentProfileActionResult> {
  return updateStudentProfileAction(input);
}

export async function readStudentProfileSaveResult(input: unknown): Promise<StudentProfileActionResult> {
  return readStudentProfileSaveResultAction(input);
}
