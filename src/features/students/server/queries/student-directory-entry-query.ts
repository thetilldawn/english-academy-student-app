import "server-only";
import { headers } from "next/headers";
import { requireAdmin } from "@/lib/auth/admin";
import type { DirectoryCacheResponse } from "../../contracts/student-directory-cache-contract";
import type { StudentDirectoryFilters } from "../../contracts/student-directory-read-model";
import { studentDirectoryCacheIdentity } from "../student-directory-cache-identity";
import { getStudentDirectoryInitial } from "./student-directory-query";

/** Standard document headers select rendering strategy, never authorization. */
export async function getStudentDirectoryCacheSeed(filters: StudentDirectoryFilters): Promise<Extract<DirectoryCacheResponse, { kind: "snapshot" }> | undefined> {
  const requestHeaders = await headers();
  const destination = requestHeaders.get("sec-fetch-dest");
  if (!(destination === "document" || (!destination && requestHeaders.get("accept")?.includes("text/html")))) return undefined;
  const admin = await requireAdmin();
  const snapshot = await getStudentDirectoryInitial({ filters }, admin);
  return { kind: "snapshot", identity: studentDirectoryCacheIdentity(admin), userId: admin.userId, snapshot };
}
