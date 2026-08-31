import "server-only";

import { headers } from "next/headers";
import { unstable_rethrow } from "next/navigation";

import {
  readRequestDeadlineAt,
  readRequestId,
} from "@/lib/observability/request-timing";

export type ServerRequestContext = {
  absoluteDeadlineAt: number | null;
  requestId: string | null;
};

export async function getCurrentRequestContext(): Promise<ServerRequestContext> {
  try {
    const requestHeaders = await headers();
    return {
      absoluteDeadlineAt: readRequestDeadlineAt(requestHeaders),
      requestId: readRequestId(requestHeaders),
    };
  } catch (error) {
    unstable_rethrow(error);
    return { absoluteDeadlineAt: null, requestId: null };
  }
}

export async function getCurrentRequestId(): Promise<string | null> {
  return (await getCurrentRequestContext()).requestId;
}
