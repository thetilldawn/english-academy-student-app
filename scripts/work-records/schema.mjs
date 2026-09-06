import { z } from "zod";

export const IMPACTS = [
  "routing", "ui", "state", "domain", "data", "api", "cache",
  "asyncUi", "security", "styles", "tests",
];
export const UI_STATES = [
  "initial-loading", "refreshing", "unselected", "empty", "validation",
  "load-error", "save-error", "auth-error", "not-found", "unexpected-error",
];
export const POLICIES = ["authorization", "data-leak", "answer-leak", "cache"];
export const TOPICS = ["behavior", "structure", "error-ui", "ui-copy", ...POLICIES];
export const TRACKING_FROM = "bc48313bc53840a44ab6505a8238eaabf7667eae";
export const RECORD_DIRECTORY = "architecture/work-records";
const text = z.string().trim().min(1);
const id = text.regex(/^[A-Za-z0-9][A-Za-z0-9_-]*$/);
const sha = z.string().regex(/^[a-f0-9]{64}$/);

export function isSafeRelativePath(value) {
  return typeof value === "string" && value.length > 0 &&
    !/[\\:\0*?#]/.test(value) && !value.startsWith("/") &&
    !value.split("/").some((part) => !part || part === "." || part === ".." ||
      /^(?:\.git|node_modules|\.env(?:\..*)?|\.next|\.codex-tmp|\.temp)$/i.test(part)) &&
    !/^(?:data\/(?:private|import)|test-results|coverage)\//.test(value);
}

export const relativePath = text.refine(isSafeRelativePath, "앱 안의 안전한 상대 파일 경로가 필요합니다.");
const ids = z.array(id);
const impact = z.object({
  status: z.enum(["changed", "checked", "not_applicable"]),
  reason: text,
}).strict();
const policy = z.object({
  status: z.enum(["applicable", "not_applicable"]),
  reason: text,
  checkIds: ids,
}).strict();

export const recordSchema = z.object({
  schemaVersion: z.literal(1),
  id,
  title: text,
  size: z.enum(["small", "full"]),
  gate: z.enum(["draft", "design", "verified"]),
  guide: relativePath,
  baseline: z.string().regex(/^[a-f0-9]{40}$/),
  owners: ids.min(1),
  plannedOwners: ids,
  plannedFlows: ids,
  dataClasses: z.array(z.enum(["none", "public", "personal", "assessment-secret"])).min(1),
  scope: z.array(z.object({
    path: relativePath,
    state: z.enum(["existing", "planned", "removed"]),
    owner: id,
    flowIds: ids,
  }).strict()).min(1),
  requirements: z.array(z.object({
    id,
    source: z.enum(["user", "engineering"]),
    text,
    acceptance: text,
    disposition: z.enum(["required", "excluded"]),
    owners: ids.min(1),
    flowIds: ids,
    checkIds: ids,
    exclusion: z.object({ decisionId: id, reason: text }).strict().optional(),
  }).strict()).min(1),
  decisions: z.array(z.object({
    id,
    owner: z.enum(["user", "engineering"]),
    state: z.enum(["open", "resolved"]),
    question: text,
    answer: text.optional(),
    source: text.optional(),
  }).strict()),
  impacts: z.object(Object.fromEntries(IMPACTS.map((key) => [key, impact]))).strict(),
  policies: z.object(Object.fromEntries(POLICIES.map((key) => [key, policy]))).strict(),
  design: z.object({
    dataFlow: text,
    reuse: text,
    cache: text,
    compatibility: text,
    rollback: text,
  }).strict(),
  uiStates: z.array(z.object({
    state: z.enum(UI_STATES),
    trigger: text,
    message: text,
    behavior: text,
    recovery: text,
    component: relativePath,
    checkIds: ids.min(1),
  }).strict()),
  standards: z.array(z.object({
    id,
    state: z.enum(["proposed", "adopted", "implemented", "verified", "retired"]),
    version: text,
    reference: text,
    reason: text,
  }).strict()).min(1),
  checks: z.array(z.object({
    id,
    kind: z.enum(["unit", "integration", "component", "static", "browser", "build", "review"]),
    target: relativePath.nullable(),
    scenario: text,
    expected: text,
    topics: z.array(z.enum(TOPICS)).min(1),
  }).strict()).min(1),
  verification: z.object({
    fingerprint: sha,
    files: z.array(z.object({
      path: relativePath,
      sha256: sha.nullable(),
    }).strict()).min(1),
    runs: z.array(z.object({
      checkId: id,
      result: z.enum(["pass", "fail", "skipped", "not_run"]),
      environment: z.enum(["local", "preview", "production"]),
      ranAt: z.iso.datetime(),
      command: text,
      summary: text,
    }).strict()),
  }).strict().nullable(),
}).strict();
