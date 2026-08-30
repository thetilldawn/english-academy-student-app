export type StudentProfilePatch = {
  displayName: string;
  gradeLabel: string | null;
  id: string;
  schoolName: string | null;
  updatedAt: string;
};

export type StudentProfileMutationReceipt = {
  directoryEffect: "refresh-first-page";
  student: StudentProfilePatch;
  version: string;
};

export type StudentProfileActionResult =
  | {
      ok: true;
      receipt: StudentProfileMutationReceipt;
    }
  | {
      current: StudentProfileMutationReceipt;
      error: string;
      ok: false;
      status: 409;
    }
  | {
      error: string;
      ok: false;
      status: 400 | 401 | 503;
    };
