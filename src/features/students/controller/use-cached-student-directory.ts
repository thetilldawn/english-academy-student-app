"use client";

import { usePrivateListEntry } from "@/features/session/public-client";
import { StudentDirectoryRequestError, type DirectoryCacheResponse } from "../contracts/student-directory-cache-contract";
import type { DirectoryCacheConsumer } from "./student-directory-cache";
import { useStudentDirectoryCache } from "./student-directory-cache-provider";

const failureFor = (error: unknown) => error instanceof StudentDirectoryRequestError ? error.message : new StudentDirectoryRequestError(503).message;
export function useCachedStudentDirectory(initialResponse?: Extract<DirectoryCacheResponse, { kind: "snapshot" }>, consumer: DirectoryCacheConsumer = "students") {
  return usePrivateListEntry(useStudentDirectoryCache(), initialResponse, consumer, failureFor, "최신 학생 목록을 다시 확인해 주세요.");
}
