import type {
  AssignmentTransport,
  AssignmentTransportRequest,
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
  recoveryForStatus?: (
    status: number,
  ) => AssignmentOperationRecovery | undefined;
  request: (idempotencyKey: string) => AssignmentTransportRequest;
};

export type AssignmentSubmissionPreparationResult<Value> =
  | { error: AssignmentOperationError; ok: false }
  | { ok: true; value: AssignmentSubmissionPreparation<Value> };

export type AssignmentSubmissionOutcome<Value> =
  | { error: AssignmentOperationError; ok: false }
  | { ok: true; replayed: boolean; value: Value };

export function createAssignmentSubmissionSession() {
  const gate = createExclusiveSubmissionGate();
  let reservation: IdempotencyReservation | null = null;
  return {
    begin: gate.begin,
    finish: gate.finish,
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
  session = createAssignmentSubmissionSession(),
  transport,
}: {
  busyMessage: string;
  clock: () => number;
  createIdempotencyKey: () => string;
  createRequestId: () => string;
  fallback: string;
  session?: AssignmentSubmissionSession;
  transport: AssignmentTransport;
}) {
  return {
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
        const prepared = prepare(clock());
        if (!prepared.ok) return prepared;
        const idempotencyKey = session.reserve(
          prepared.value.fingerprint,
          createIdempotencyKey,
        );
        const result = await executeAssignmentRequest({
          fallback: prepared.value.fallback || fallback,
          failureRecovery: prepared.value.recoveryForStatus,
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
