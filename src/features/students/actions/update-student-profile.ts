"use server";

import type { StudentProfileActionResult } from "../contracts/student-mutation-result";
import { updateStudentProfileAction } from "../server/actions/update-student-profile-action";

export async function updateStudentProfile(
  input: unknown,
): Promise<StudentProfileActionResult> {
  return updateStudentProfileAction(input);
}
