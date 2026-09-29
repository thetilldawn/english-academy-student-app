import type {
  AssignmentTransport,
  AssignmentTransportRequest,
  AssignmentTransportResponse,
} from "../transport/assignment-transport";
import {
  reserveIdempotencyKey,
  type IdempotencyReservation,
} from "../domain/fingerprint";
import {
  assignmentBusyFailure,
  assignmentFailureFromCause,
  type AssignmentOperationError,
  type AssignmentOperationRecovery,
} from "./assignment-operation-error";
import { executeAssignmentRequest } from "./execute-assignment-request";
import { createExclusiveSubmissionGate } from "./request-lifecycle";

export type AssignmentSubmissionPreparation<Value> = {
  fallback: string;
  fingerprint: string;
  parse: (data: unknown) => Value;
  recoveryForResponse?: (
    response: AssignmentTransportResponse,
  ) => AssignmentOperationRecovery | undefined;
  request: (idempotencyKey: string) => AssignmentTransportRequest;
};

export type AssignmentSubmissionPreparationResult<Value> =
  | { error: AssignmentOperationError; ok: false }
  | { ok: true; value: AssignmentSubmissionPreparation<Value> };

export type AssignmentSubmissionOutcome<Value> =
  | { error: AssignmentOperationError; ok: false; uncertain?: boolean }
  | { ok: true; replayed: boolean; value: Value };

type RetainedSubmission = {
  fallback: string;
  parse: (data: unknown) => unknown;
  recoveryForResponse?: AssignmentSubmissionPreparation<unknown>["recoveryForResponse"];
  request: AssignmentTransportRequest;
};

function copyRequest(request: AssignmentTransportRequest): AssignmentTransportRequest {
  return { ...request, body: structuredClone(request.body) };
}

function definitelyRejected(error: AssignmentOperationError) {
  return error.status !== undefined && [400, 401, 403, 404, 409, 422].includes(error.status);
}

export function createAssignmentSubmissionSession() {
  const gate = createExclusiveSubmissionGate();
  let reservation: IdempotencyReservation | null = null;
  let retained: RetainedSubmission | null = null;
  return {
    begin: gate.begin,
    finish: gate.finish,
    retained: () => retained,
    retain(value: RetainedSubmission | null) { retained = value; },
    reserve(fingerprint: string, createIdempotencyKey: () => string) {
      reservation = reserveIdempotencyKey(
        reservation,
        fingerprint,
        createIdempotencyKey,
      );
      return reservation.key;
    },
  };
}

export type AssignmentSubmissionSession = ReturnType<
  typeof createAssignmentSubmissionSession
>;

export function createAssignmentSubmissionFlow({
  busyMessage,
  clock,
  createIdempotencyKey,
  createRequestId,
  fallback,
  retainUncertainSubmission = false,
  session = createAssignmentSubmissionSession(),
  transport,
}: {
  busyMessage: string;
  clock: () => number;
  createIdempotencyKey: () => string;
  createRequestId: () => string;
  fallback: string;
  retainUncertainSubmission?: boolean;
  session?: AssignmentSubmissionSession;
  transport: AssignmentTransport;
}) {
  async function executeStored<Value>(stored: RetainedSubmission, recovering: boolean): Promise<AssignmentSubmissionOutcome<Value>> {
    const result = await executeAssignmentRequest({
      fallback: stored.fallback,
      failureRecovery: stored.recoveryForResponse,
      parse: stored.parse,
      request: copyRequest(stored.request),
      transport,
    });
    if (result.ok) {
      session.retain(null);
      // Only the same submission session may recover its original validated value.
      return { ok: true, replayed: recovering, value: result.value as Value };
    }
    const uncertain = recovering || !definitelyRejected(result.error);
    session.retain(uncertain ? stored : null);
    return { ...result, uncertain };
  }
  return {
    async recover<Value>(): Promise<AssignmentSubmissionOutcome<Value>> {
      const requestId = createRequestId();
      if (!session.begin(requestId)) return { ok: false, error: assignmentBusyFailure(busyMessage) };
      try {
        const stored = session.retained();
        if (!stored) return { ok: false, error: assignmentBusyFailure("확인할 저장 요청이 없습니다.") };
        return await executeStored<Value>(stored, true);
      } finally {
        session.finish(requestId);
      }
    },
    async run<Value>(
      prepare: (
        nowMilliseconds: number,
      ) => AssignmentSubmissionPreparationResult<Value>,
    ): Promise<AssignmentSubmissionOutcome<Value>> {
      const requestId = createRequestId();
      if (!session.begin(requestId)) {
        return { error: assignmentBusyFailure(busyMessage), ok: false };
      }
      try {
        if (retainUncertainSubmission && session.retained()) {
          return { ok: false, uncertain: true, error: assignmentBusyFailure("먼저 이전 저장 결과를 확인해 주세요.") };
        }
        const prepared = prepare(clock());
        if (!prepared.ok) return prepared;
        const idempotencyKey = session.reserve(
          prepared.value.fingerprint,
          createIdempotencyKey,
        );
        if (retainUncertainSubmission) {
          const stored: RetainedSubmission = {
            fallback: prepared.value.fallback || fallback,
            parse: prepared.value.parse,
            recoveryForResponse: prepared.value.recoveryForResponse,
            request: copyRequest(prepared.value.request(idempotencyKey)),
          };
          return await executeStored<Value>(stored, false);
        }
        const result = await executeAssignmentRequest({
          fallback: prepared.value.fallback || fallback,
          failureRecovery: prepared.value.recoveryForResponse,
          parse: prepared.value.parse,
          request: prepared.value.request(idempotencyKey),
          transport,
        });
        if (!result.ok) return result;
        return { ok: true, replayed: false, value: result.value };
      } catch (error) {
        return {
          error: assignmentFailureFromCause(error, fallback),
          ok: false,
        };
      } finally {
        session.finish(requestId);
      }
    },
  };
}
