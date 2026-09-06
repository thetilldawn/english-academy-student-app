import { recordSchema, UI_STATES, POLICIES } from "./schema.mjs";
import { captureFingerprint, fileExists, fingerprintForInputs, isImplementationPath } from "./evidence.mjs";

function requiredChecks(record) {
  return new Set([
    ...record.requirements.filter((item) => item.disposition === "required").flatMap((item) => item.checkIds),
    ...Object.values(record.policies).filter((item) => item.status === "applicable").flatMap((item) => item.checkIds),
    ...record.uiStates.flatMap((item) => item.checkIds),
  ]);
}

function duplicateErrors(values, label, errors) {
  const seen = new Set();
  for (const value of values) {
    if (seen.has(value)) errors.push(label + " 중복: " + value);
    seen.add(value);
  }
}

export function validateRecord(input, context, phase = "format") {
  const parsed = recordSchema.safeParse(input);
  if (!parsed.success) {
    return parsed.error.issues.map((issue) => issue.path.join(".") + ": " + issue.message);
  }
  const record = parsed.data;
  const errors = [];
  if (!["format", "design", "complete"].includes(phase)) return ["알 수 없는 검사 단계: " + phase];
  const checks = new Map(record.checks.map((item) => [item.id, item]));
  const decisions = new Map(record.decisions.map((item) => [item.id, item]));
  for (const key of ["requirements", "decisions", "checks", "standards"]) {
    duplicateErrors(record[key].map((item) => item.id), key, errors);
  }
  duplicateErrors(record.scope.map((item) => item.path), "scope", errors);
  duplicateErrors(record.owners, "owners", errors);
  duplicateErrors(record.plannedOwners, "plannedOwners", errors);
  duplicateErrors(record.plannedFlows, "plannedFlows", errors);
  duplicateErrors(record.dataClasses, "dataClasses", errors);
  duplicateErrors(record.uiStates.map((item) => item.state), "uiStates", errors);
  if (record.dataClasses.includes("none") && record.dataClasses.length > 1) errors.push("none 자료 성격을 다른 성격과 섞을 수 없습니다.");
  const refs = (values, label) => {
    duplicateErrors(values, label, errors);
    for (const value of values) if (!checks.has(value)) errors.push(label + "의 검사 없음: " + value);
  };
  for (const requirement of record.requirements) {
    refs(requirement.checkIds, requirement.id);
    for (const owner of requirement.owners) {
      if (!record.owners.includes(owner)) errors.push(requirement.id + "의 소유자가 작업 범위에 없음: " + owner);
    }
    if (requirement.disposition === "required") {
      if (!requirement.checkIds.length) errors.push(requirement.id + ": 필수 요구의 검사 연결 누락");
      if (requirement.exclusion) errors.push(requirement.id + ": 필수 요구와 제외 근거가 혼재");
    } else {
      const decision = decisions.get(requirement.exclusion?.decisionId);
      if (!decision || decision.state !== "resolved" ||
          (requirement.source === "user" && decision.owner !== "user")) {
        errors.push(requirement.id + ": 제외에는 해결된 해당 결정 근거가 필요합니다.");
      }
    }
  }
  for (const decision of record.decisions) {
    if (decision.state === "resolved" && (!decision.answer || !decision.source)) {
      errors.push(decision.id + ": 결정 답변·근거 누락");
    }
  }
  for (const topic of POLICIES) {
    const policy = record.policies[topic];
    refs(policy.checkIds, topic);
    if (policy.status === "applicable" && (!policy.checkIds.length ||
        !policy.checkIds.some((id) => checks.get(id)?.topics.includes(topic)))) {
      errors.push(topic + ": 해당 정책의 검사 계획 누락");
    }
  }
  if (record.dataClasses.some((item) => ["personal", "assessment-secret"].includes(item))) {
    for (const topic of ["authorization", "data-leak"]) {
      if (record.policies[topic].status !== "applicable") errors.push(topic + ": 개인/비공개 자료에서 생략할 수 없습니다.");
    }
  }
  if (record.dataClasses.includes("assessment-secret") && record.policies["answer-leak"].status !== "applicable") {
    errors.push("answer-leak: 비공개 평가 자료의 정답 노출 검사 누락");
  }
  if (record.impacts.cache.status !== "not_applicable" && record.policies.cache.status !== "applicable") {
    errors.push("cache: 캐시 영향에 대한 검사 누락");
  }
  if (record.impacts.ui.status !== "not_applicable" || record.impacts.asyncUi.status !== "not_applicable") {
    for (const state of UI_STATES) {
      if (!record.uiStates.some((item) => item.state === state)) errors.push("화면 상태 누락: " + state);
    }
  }
  for (const state of record.uiStates) {
    refs(state.checkIds, state.state);
    if (!state.checkIds.some((id) => checks.get(id)?.topics.includes("error-ui"))) {
      errors.push(state.state + ": 표시·복구 검사 연결 누락");
    }
    if (!state.checkIds.some((id) => checks.get(id)?.topics.includes("ui-copy"))) {
      errors.push(state.state + ": 쉬운 안내 문구 검사 연결 누락");
    }
  }
  if (record.verification) {
    duplicateErrors(record.verification.runs.map((item) => item.checkId), "실행 근거", errors);
    duplicateErrors(record.verification.files.map((item) => item.path), "검사 파일", errors);
    refs(record.verification.runs.map((item) => item.checkId), "실행 근거");
    for (const file of record.verification.files) {
      if (!isImplementationPath(file.path)) errors.push("검사 지문에 기록/비구현 경로 포함: " + file.path);
    }
  }
  if (record.gate === "verified" && !record.verification) errors.push("verified 선언에 검사 근거가 없습니다.");
  if (record.gate === "verified" && record.verification) {
    if (fingerprintForInputs(record, record.verification.files) !== record.verification.fingerprint) errors.push("과거 기록의 설계/입력 지문이 변경되었습니다.");
    for (const id of requiredChecks(record)) {
      if (!record.verification.runs.some((run) => run.checkId === id && run.result === "pass")) errors.push(id + ": 필수 검사가 통과하지 않았습니다.");
    }
  }
  if (phase === "format") {
    try {
      if (!fileExists(context.root, record.guide)) errors.push("현재 파일 없음: " + record.guide);
      // A historical, verified record retains the paths that existed at that time.
      // Re-check current paths in design/complete, not by rewriting past evidence.
      if (record.gate !== "verified") {
        for (const owner of record.owners) {
          if (!context.owners.includes(owner) && !record.plannedOwners.includes(owner)) errors.push("등록되지 않은 소유자: " + owner);
        }
        for (const item of record.scope) {
          if (!record.owners.includes(item.owner)) errors.push("범위의 소유자 누락: " + item.path);
          if (item.state === "existing" && !fileExists(context.root, item.path)) errors.push("현재 파일 없음: " + item.path);
        }
        for (const id of [...record.scope, ...record.requirements].flatMap((item) => item.flowIds)) {
          if (!context.flows.includes(id) && !record.plannedFlows.includes(id)) errors.push("등록되지 않은 흐름: " + id);
        }
      }
    } catch (error) { errors.push(error.message); }
    return errors;
  }

  if (record.gate === "draft") errors.push("설계가 draft입니다. 미결정을 해결한 뒤 design으로 검토하세요.");
  for (const decision of record.decisions) {
    if (decision.state === "open") errors.push(decision.id + ": 미결정이 있어 해당 기능 전체 구현을 보류합니다.");
  }
  const knownOwner = (id) => context.owners.includes(id) || phase === "design" && record.plannedOwners.includes(id);
  const knownFlow = (id) => context.flows.includes(id) || phase === "design" && record.plannedFlows.includes(id);
  for (const owner of record.owners) if (!knownOwner(owner)) errors.push("등록되지 않은 소유자: " + owner);
  const pathCheck = (file, required = true) => {
    try {
      if (!fileExists(context.root, file) && required) errors.push("현재 파일 없음: " + file);
    } catch (error) {
      errors.push(error.message);
    }
  };
  pathCheck(record.guide);
  for (const item of record.scope) {
    if (!record.owners.includes(item.owner)) errors.push("범위의 소유자 누락: " + item.path);
    for (const id of item.flowIds) if (!knownFlow(id)) errors.push("범위의 흐름 없음: " + id);
    if (item.state === "planned" && phase === "complete") errors.push("예정 경로가 구현 경로로 전환되지 않음: " + item.path);
    if (item.state !== "removed") pathCheck(item.path, item.state !== "planned" || phase === "complete");
    else if (phase === "complete") {
      try {
        if (fileExists(context.root, item.path)) errors.push("삭제 경로가 남아 있음: " + item.path);
      } catch (error) { errors.push(error.message); }
    }
    const owner = context.ownerForPath(item.path);
    if (owner && owner !== item.owner) errors.push("실제 소유자와 범위 불일치: " + item.path);
    if (phase === "complete" && isImplementationPath(item.path) && !owner) errors.push("소유 지도에 없는 구현 경로: " + item.path);
    if (phase === "complete" && item.state !== "removed") {
      const actualFlows = context.flowIdsForPath(item.path);
      for (const id of item.flowIds) {
        if (!actualFlows.includes(id)) errors.push("실제 경로와 연결되지 않은 흐름: " + item.path + " -> " + id);
      }
      for (const id of actualFlows) {
        if (!item.flowIds.includes(id)) errors.push("구현의 영향 흐름 누락: " + item.path + " -> " + id);
      }
    }
  }
  for (const requirement of record.requirements) {
    for (const id of requirement.flowIds) if (!knownFlow(id)) errors.push(requirement.id + ": 흐름 등록 없음: " + id);
    if (requirement.disposition === "required") {
      for (const owner of requirement.owners) {
        if (!record.scope.some((item) => item.owner === owner)) errors.push(requirement.id + ": 소유자의 구현 범위 없음: " + owner);
      }
      for (const id of requirement.flowIds) {
        if (!record.scope.some((item) => item.flowIds.includes(id))) errors.push(requirement.id + ": 범위와 흐름 연결 누락: " + id);
      }
    }
  }
  for (const check of record.checks) {
    if (check.target) pathCheck(check.target, phase === "complete");
    if (["unit", "component", "integration"].includes(check.kind) && !check.target) errors.push(check.id + ": 검사 파일 누락");
  }
  for (const item of record.uiStates) pathCheck(item.component, phase === "complete");
  if (phase !== "complete") return errors;

  if (record.plannedOwners.length || record.plannedFlows.length) errors.push("예정 소유자/흐름을 실제 등록으로 전환해야 합니다.");
  if (!record.verification) return [...errors, "실행 근거가 없습니다."];
  for (const id of requiredChecks(record)) {
    if (!record.verification.runs.some((item) => item.checkId === id && item.result === "pass")) {
      errors.push(id + ": 필수 검사가 통과하지 않았습니다.");
    }
  }
  try {
    const current = captureFingerprint(record, context);
    if (current.fingerprint !== record.verification.fingerprint ||
        JSON.stringify(current.files) !== JSON.stringify(record.verification.files)) {
      errors.push("검사 근거의 코드/설계 지문이 현재 입력과 다릅니다. 관련 검사를 다시 실행하세요.");
    }
  } catch (error) {
    errors.push(error.message);
  }
  return errors;
}

export function validateChangedCoverage(changes, records, context) {
  const errors = [];
  const validation = new Map();
  const invalid = records.flatMap((record) => validateRecord(record, context, "format"));
  if (invalid.length) return invalid;
  for (const change of changes.filter((item) => isImplementationPath(item.filePath))) {
    const candidates = records.filter((record) => record.scope.some((item) => item.path === change.filePath));
    const openFeature = records.find((record) => record.decisions.some((item) => item.state === "open") &&
      (candidates.includes(record) || record.owners.some((owner) => context.featureOwners.includes(owner) && change.mapped.owners.includes(owner))));
    if (openFeature) {
      errors.push(openFeature.id + ": 미결정 기능의 구현 변경 금지: " + change.filePath);
      continue;
    }
    if (!candidates.length) {
      errors.push("작업 기록 없는 구현 변경: " + change.filePath);
      continue;
    }
    let covered = false;
    for (const record of candidates) {
      if (record.gate !== "verified") {
        if (!validation.has(record.id)) validation.set(record.id, validateRecord(record, context, "design"));
        if (validation.get(record.id).length) continue;
      }
      const scope = record.scope.find((item) => item.path === change.filePath);
      if (change.mapped.owners.length && !change.mapped.owners.includes(scope.owner)) continue;
      if (change.mapped.flows.some((id) => !scope.flowIds.includes(id))) continue;
      if (record.gate === "verified") {
        const current = captureFingerprint(record, context).files.find((item) => item.path === change.filePath);
        const prior = record.verification?.files.find((item) => item.path === change.filePath);
        if (!current || !prior || current.sha256 !== prior.sha256) continue;
      }
      covered = true;
    }
    if (!covered) errors.push("유효한 설계/현재 변경 근거 없음: " + change.filePath);
  }
  return errors;
}
