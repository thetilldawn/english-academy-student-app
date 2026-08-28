import type {
  AssignmentTransport,
  AssignmentTransportRequest,
} from "../transport/assignment-transport";
import {
  assignmentFailureFromCause,
  assignmentFailureFromResponse,
  assignmentProtocolFailure,
  type AssignmentOperationError,
  type AssignmentOperationRecovery,
} from "./assignment-operation-error";

export type AssignmentExecutionResult<Value> =
  | { ok: true; value: Value }
  | { error: AssignmentOperationError; ok: false };

export async function executeAssignmentRequest<Value>({
  fallback,
  failureRecovery,
  parse,
  request,
  transport,
}: {
  fallback: string;
  failureRecovery?: (status: number) => AssignmentOperationRecovery | undefined;
  parse: (data: unknown) => Value;
  request: AssignmentTransportRequest;
  transport: AssignmentTransport;
}): Promise<AssignmentExecutionResult<Value>> {
  try {
    const response = await transport(request);
    if (request.signal?.aborted) {
      return {
        error: assignmentFailureFromCause(
          { name: "AbortError" },
          fallback,
        ),
        ok: false,
      };
    }
    if (!response.ok) {
      return {
        error: assignmentFailureFromResponse(
          response,
          fallback,
          failureRecovery?.(response.status),
        ),
        ok: false,
      };
    }
    try {
      return { ok: true, value: parse(response.data) };
    } catch {
      return { error: assignmentProtocolFailure(fallback), ok: false };
    }
  } catch (error) {
    return { error: assignmentFailureFromCause(error, fallback), ok: false };
  }
}
