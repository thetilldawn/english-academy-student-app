export type AssignmentRequestIdentity = {
  fingerprint: string;
  requestId: string;
  revision: number;
};

function sameRequest(
  left: AssignmentRequestIdentity | null,
  right: AssignmentRequestIdentity,
) {
  return Boolean(
    left &&
      left.fingerprint === right.fingerprint &&
      left.requestId === right.requestId &&
      left.revision === right.revision,
  );
}

export function createLatestRequestPolicy() {
  let current: AssignmentRequestIdentity | null = null;
  return {
    cancel(identity?: AssignmentRequestIdentity) {
      if (!identity || sameRequest(current, identity)) current = null;
    },
    isCurrent(identity: AssignmentRequestIdentity) {
      return sameRequest(current, identity);
    },
    start(identity: AssignmentRequestIdentity) {
      current = identity;
    },
  };
}

export function createExclusiveSubmissionGate() {
  let activeRequestId: string | null = null;
  return {
    begin(requestId: string) {
      if (activeRequestId !== null) return false;
      activeRequestId = requestId;
      return true;
    },
    finish(requestId: string) {
      if (activeRequestId === requestId) activeRequestId = null;
    },
    isActive(requestId: string) {
      return activeRequestId === requestId;
    },
  };
}
