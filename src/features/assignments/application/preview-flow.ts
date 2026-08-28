import type {
  AssignmentTransport,
  AssignmentTransportRequest,
} from "../transport/assignment-transport";
import type { AssignmentOperationRecovery } from "./assignment-operation-error";
import { executeAssignmentRequest } from "./execute-assignment-request";
import type {
  AssignmentRequestIdentity,
} from "./request-lifecycle";

export type AssignmentPreviewPreparation<Value> = {
  fallback: string;
  fingerprint: string;
  parse: (data: unknown) => Value;
  recoveryForStatus?: (
    status: number,
  ) => AssignmentOperationRecovery | undefined;
  request: AssignmentTransportRequest;
};

export type AssignmentPreviewOutcome<Value> =
  | { status: "stale" }
  | {
      identity: AssignmentRequestIdentity;
      result: Awaited<ReturnType<typeof executeAssignmentRequest<Value>>>;
      status: "settled";
    };

export async function runAssignmentPreview<Value>({
  identity,
  isCurrent,
  preparation,
  transport,
}: {
  identity: AssignmentRequestIdentity;
  isCurrent: (identity: AssignmentRequestIdentity) => boolean;
  preparation: AssignmentPreviewPreparation<Value>;
  transport: AssignmentTransport;
}): Promise<AssignmentPreviewOutcome<Value>> {
  const result = await executeAssignmentRequest({
    fallback: preparation.fallback,
    failureRecovery: preparation.recoveryForStatus,
    parse: preparation.parse,
    request: preparation.request,
    transport,
  });
  if (!isCurrent(identity)) return { status: "stale" };
  return { identity, result, status: "settled" };
}
