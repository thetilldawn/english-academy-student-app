"use client";

import { usePrivateListEntry } from "@/features/session/public-client";
import { adminStudentsText } from "@/content/ko/admin-students";
import { StudentDirectoryRequestError, type DirectoryCacheResponse } from "../contracts/student-directory-cache-contract";
import type { DirectoryCacheConsumer } from "./student-directory-cache";
import { useStudentDirectoryCache } from "./student-directory-cache-provider";

const failureFor = (error: unknown) => error instanceof StudentDirectoryRequestError ? error.message : new StudentDirectoryRequestError(503).message;
export function useCachedStudentDirectory(initialResponse?: Extract<DirectoryCacheResponse, { kind: "snapshot" }>, consumer: DirectoryCacheConsumer = "students") {
  return usePrivateListEntry(useStudentDirectoryCache(), initialResponse, consumer, failureFor, adminStudentsText.page.expired, {
    retainActiveSnapshot: consumer === "assignments",
  });
}
