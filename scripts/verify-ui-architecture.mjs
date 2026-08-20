import fs from "node:fs";
import path from "node:path";

import postcss from "postcss";

const rootDirectory = process.cwd();

function read(relativePath) {
  return fs.readFileSync(path.join(rootDirectory, relativePath), "utf8");
}

function filesUnder(relativeDirectory, predicate) {
  const absoluteDirectory = path.join(rootDirectory, relativeDirectory);
  return fs
    .readdirSync(absoluteDirectory, { withFileTypes: true })
    .flatMap((entry) => {
      const relativePath = path
        .join(relativeDirectory, entry.name)
        .replaceAll("\\", "/");
      if (entry.isDirectory()) return filesUnder(relativePath, predicate);
      return predicate(relativePath) ? [relativePath] : [];
    });
}

function lineCount(source) {
  return source.replace(/\r\n/g, "\n").replace(/\n$/, "").split("\n")
    .length;
}

function count(source, pattern) {
  return [...source.matchAll(pattern)].length;
}

function normalizeWhitespace(value) {
  return value.replace(/\s+/g, " ").trim();
}

function atRuleContext(node) {
  const context = [];
  let parent = node.parent;
  while (parent) {
    if (parent.type === "atrule") {
      context.push(
        `@${parent.name} ${normalizeWhitespace(parent.params ?? "")}`,
      );
    }
    parent = parent.parent;
  }
  return context.reverse().join(" > ");
}

function isKeyframeRule(rule) {
  let parent = rule.parent;
  while (parent) {
    if (
      parent.type === "atrule" &&
      /keyframes$/i.test(parent.name)
    ) {
      return true;
    }
    parent = parent.parent;
  }
  return false;
}

const cssPath = "src/app/globals.css";
const css = read(cssPath);
const cssRoot = postcss.parse(css, { from: cssPath });
const selectorContextCounts = new Map();
const mediaConditions = new Set();
let styleRules = 0;
let styleDeclarations = 0;
let importantDeclarations = 0;
let mediaBlocks = 0;

cssRoot.walkRules((rule) => {
  if (isKeyframeRule(rule)) return;
  styleRules += 1;
  const context = atRuleContext(rule);
  for (const selector of postcss.list.comma(rule.selector)) {
    const key = `${context}\u0000${normalizeWhitespace(selector)}`;
    selectorContextCounts.set(
      key,
      (selectorContextCounts.get(key) ?? 0) + 1,
    );
  }
});

cssRoot.walkDecls((declaration) => {
  let parent = declaration.parent;
  while (parent && parent.type !== "rule") parent = parent.parent;
  if (parent?.type === "rule" && !isKeyframeRule(parent)) {
    styleDeclarations += 1;
    if (declaration.important) importantDeclarations += 1;
  }
});

cssRoot.walkAtRules("media", (atRule) => {
  mediaBlocks += 1;
  mediaConditions.add(normalizeWhitespace(atRule.params));
});

const duplicateCounts = [...selectorContextCounts.values()].filter(
  (value) => value > 1,
);
const sectionMarkers = [
  "Shared assignment editor layout",
  "Atomic bulk vocabulary assignment",
  "Student-centered learning management v2",
  "Final redesign contract: DESIGN_1.md",
  "Admin metadata tags and content-driven density",
  "Student learning workspace completion",
  "Shared interactive UI contracts",
  "APP-20260809-07: shared activity rows and route detail",
  "APP-20260809-08: mobile student lists, assignment tags, and code view",
];
const allowedTopLevelComments = new Set([
  ...sectionMarkers,
  "Only visible English content reserves a stable pronunciation column.",
]);
const topLevelComments = cssRoot.nodes
  .filter((node) => node.type === "comment")
  .map((node) => node.text.trim());

const cssMetrics = {
  lines: lineCount(css),
  styleRules,
  selectorContextKeys: selectorContextCounts.size,
  duplicateContextKeys: duplicateCounts.length,
  duplicateExcess: duplicateCounts.reduce(
    (total, value) => total + value - 1,
    0,
  ),
  styleDeclarations,
  mediaBlocks,
  mediaConditions: mediaConditions.size,
  importantDeclarations,
  trackedSectionMarkers: sectionMarkers.filter((marker) =>
    css.includes(marker),
  ).length,
  untrackedTopLevelComments: topLevelComments.filter(
    (comment) => !allowedTopLevelComments.has(comment),
  ).length,
};

const cssMaximums = {
  lines: 1000,
  styleRules: 12,
  selectorContextKeys: 12,
  duplicateContextKeys: 0,
  duplicateExcess: 0,
  styleDeclarations: 50,
  mediaBlocks: 3,
  mediaConditions: 3,
  importantDeclarations: 0,
  trackedSectionMarkers: 0,
  untrackedTopLevelComments: 0,
};

const legacyComponents = [];
const assignmentFeatureContracts = [
  {
    path: "src/features/assignments/controller/use-assignment-workspace.ts",
    maxLines: 430,
    maxFetchCalls: 0,
    maxUseStateCalls: 7,
  },
  {
    path: "src/features/assignments/controller/use-assignment-controller.ts",
    maxLines: 700,
    maxFetchCalls: 0,
    maxUseStateCalls: 5,
  },
  {
    path: "src/features/assignments/controller/use-assignment-preview.ts",
    maxLines: 220,
    maxFetchCalls: 0,
    maxUseStateCalls: 0,
  },
  {
    path: "src/features/assignments/controller/use-bulk-assignment-controller.ts",
    maxLines: 520,
    maxFetchCalls: 0,
    maxUseStateCalls: 4,
  },
  {
    path: "src/features/assignments/controller/use-vocab-assignment-planner.ts",
    maxLines: 450,
    maxFetchCalls: 0,
    maxUseStateCalls: 2,
  },
  {
    path: "src/features/assignments/controller/use-vocab-assignment-screen.ts",
    maxLines: 150,
    maxFetchCalls: 0,
    maxUseStateCalls: 2,
  },
  {
    path: "src/features/assignments/controller/use-legacy-review-recovery.ts",
    maxLines: 120,
    maxFetchCalls: 0,
    maxUseStateCalls: 2,
  },
  {
    path: "src/features/assignments/ui/single-assignment-editor.tsx",
    maxLines: 280,
    maxFetchCalls: 0,
    maxUseStateCalls: 0,
  },
];
const studentFeatureContracts = [
  {
    path: "src/features/students/controller/use-student-detail-controller.ts",
    maxLines: 600,
    maxFetchCalls: 0,
    maxUseStateCalls: 4,
  },
  {
    path: "src/features/students/domain/student-directory.ts",
    maxLines: 140,
    maxFetchCalls: 0,
    maxUseStateCalls: 0,
  },
  {
    path: "src/features/students/ui/student-directory.tsx",
    maxLines: 600,
    maxFetchCalls: 0,
    maxUseStateCalls: 1,
  },
  {
    path: "src/features/students/ui/student-detail-dialog.tsx",
    maxLines: 180,
    maxFetchCalls: 0,
    maxUseStateCalls: 0,
  },
  {
    path: "src/features/students/ui/panels/student-wrong-word-panel.tsx",
    maxLines: 1120,
    maxFetchCalls: 0,
    maxUseStateCalls: 15,
  },
];
const studentDashboardFeatureContracts = [
  {
    path: "src/features/student-dashboard/domain/student-assignment-sections.ts",
    maxLines: 140,
    maxFetchCalls: 0,
    maxUseStateCalls: 0,
  },
  {
    path: "src/features/student-dashboard/ui/student-assignment-card.tsx",
    maxLines: 240,
    maxFetchCalls: 0,
    maxUseStateCalls: 0,
  },
  {
    path: "src/features/student-dashboard/ui/student-dashboard.tsx",
    maxLines: 110,
    maxFetchCalls: 0,
    maxUseStateCalls: 0,
  },
];
const quizPlayerFeatureContracts = [
  {
    path: "src/features/quiz-player/controller/quiz-audio-player.ts",
    maxLines: 110,
    maxFetchCalls: 0,
    maxUseStateCalls: 0,
  },
  {
    path: "src/features/quiz-player/controller/use-initial-quiz-synchronization.ts",
    maxLines: 30,
    maxFetchCalls: 0,
    maxUseStateCalls: 0,
  },
  {
    path: "src/features/quiz-player/controller/use-quiz-audio.ts",
    maxLines: 60,
    maxFetchCalls: 0,
    maxUseStateCalls: 0,
  },
  {
    path: "src/features/quiz-player/controller/use-quiz-player-controller.ts",
    maxLines: 380,
    maxFetchCalls: 0,
    maxUseStateCalls: 0,
  },
  {
    path: "src/features/quiz-player/controller/use-quiz-clock.ts",
    maxLines: 70,
    maxFetchCalls: 0,
    maxUseStateCalls: 0,
  },
  {
    path: "src/features/quiz-player/controller/use-quiz-recovery.ts",
    maxLines: 90,
    maxFetchCalls: 0,
    maxUseStateCalls: 0,
  },
  {
    path: "src/features/quiz-player/ui/quiz-player.tsx",
    maxLines: 150,
    maxFetchCalls: 0,
    maxUseStateCalls: 0,
  },
  {
    path: "src/features/quiz-player/ui/quiz-frame.tsx",
    maxLines: 300,
    maxFetchCalls: 0,
    maxUseStateCalls: 0,
  },
];
const legacyPaths = new Set(
  legacyComponents.map((contract) => contract.path),
);
const violations = [];
const allowedGlobalClasses = new Set([
  "app-sonner-toast",
  "app-sonner-toast-error",
  "app-sonner-toast-success",
  "skip-link",
  "sr-only",
]);

cssRoot.walkRules((rule) => {
  if (isKeyframeRule(rule)) return;
  for (const match of rule.selector.matchAll(/\.([A-Za-z_][\w-]*)/g)) {
    if (!allowedGlobalClasses.has(match[1])) {
      violations.push(
        `globals.css retains feature class selector .${match[1]}`,
      );
    }
  }
});

const migratedPrimitiveSelectors = [
  /^\.button(?:\b|[.:\s])/m,
  /^\.field(?:\b|[.:\s])/m,
  /^\.select-field(?:\b|[.:\s])/m,
  /^\.segmented-control(?:\b|[.:\s])/m,
  /^\.status-pill(?:\b|[.:\s])/m,
  /^\.status-badge(?:\b|[.:\s])/m,
  /^\.count-badge(?:\b|[.:\s])/m,
  /^\.meta-tag(?:\b|[.:\s])/m,
  /^\.app-tab(?:\b|[.:\s])/m,
  /^\.management-tabs(?:\b|[.:\s])/m,
  /^\.help-tip(?:\b|[.:\s])/m,
  /^\.label-with-help(?:\b|[.:\s])/m,
  /^\.modal-frame(?:\b|[.:\s])/m,
  /^\.nav-links?(?:\b|[.:\s])/m,
  /^\.theme-toggle(?:\b|[.:\s])/m,
];

for (const selector of migratedPrimitiveSelectors) {
  if (selector.test(css)) {
    violations.push(`globals.css retains migrated primitive selector ${selector}`);
  }
}

for (const retiredPath of [
  "src/components/quiz-player.tsx",
  "src/components/student-manager.tsx",
  "src/components/student-learning-source-list.tsx",
  "src/components/student-vocab-book-history-list.tsx",
  "src/components/student-wrong-word-panel.tsx",
  "src/components/assignment-manager.tsx",
  "src/components/admin-history-actions.tsx",
  "src/components/admin-history-detail.tsx",
  "src/components/history-detail-actions.tsx",
  "src/components/start-retry-button.tsx",
  "src/components/deadline-countdown.tsx",
  "src/components/start-attempt-button.tsx",
  "src/components/bulk-assignment-dialog.tsx",
  "src/components/review-assignment-dialog.tsx",
  "src/components/ui-button.tsx",
  "src/components/ui-select.tsx",
  "src/components/status-badge.tsx",
  "src/components/count-badge.tsx",
  "src/components/admin-meta-tags.tsx",
  "src/components/ui-modal.tsx",
  "src/components/ui-tabs.tsx",
  "src/components/help-tip.tsx",
  "src/components/activity-status-timeline.tsx",
  "src/components/admin-history-list.tsx",
  "src/components/assignment-meta-tags.tsx",
  "src/components/attempt-score-summary.tsx",
  "src/components/overview-action-groups.tsx",
  "src/components/route-detail-dialog.tsx",
  "src/components/student-learning-activity-list.tsx",
  "src/components/ui-list-row.tsx",
  "src/lib/admin/learning-activity.ts",
  "src/lib/ui/attempt-score-presentation.ts",
  "src/lib/ui/learning-activity-presentation.ts",
]) {
  if (fs.existsSync(path.join(rootDirectory, retiredPath))) {
    violations.push(`${retiredPath} should be retired after primitive migration`);
  }
}

for (const retiredSelector of [
  ".student-admin-workspace",
  ".student-action-",
  ".student-select-button",
  ".student-management-",
  ".student-search-",
  ".student-create-",
  ".student-group-",
  ".student-card",
  ".student-dialog-",
  ".student-book-",
  ".student-progress-",
  ".student-profile-",
  ".student-inline-assignment-",
  ".student-learning-",
  ".student-vocab-",
  ".student-code-",
  ".wrong-word-",
  ".wrong-attempt-",
  ".reading-context-status",
]) {
  if (css.includes(retiredSelector)) {
    violations.push(
      `globals.css retains migrated student selector ${retiredSelector}`,
    );
  }
}

for (const retiredSelector of [
  ".student-page-heading",
  ".student-assignment-grid",
  ".assignment-card",
  ".assignment-details",
  ".assignment-deadline",
  ".assignment-actions",
  ".deadline-countdown",
  ".deadline-expired",
]) {
  if (css.includes(retiredSelector)) {
    violations.push(
      `globals.css retains migrated student dashboard selector ${retiredSelector}`,
    );
  }
}

const retiredActivitySelectors = [
  ".activity-status-timeline",
  ".activity-row-",
  ".openable-list-row",
  ".selectable-list-row",
  ".admin-history-row",
  ".admin-history-list",
  ".assignment-student-row",
  ".assignment-student-identity",
  ".assignment-student-book",
  ".assignment-student-recent",
  ".attempt-score-summary",
  ".attempt-score-slot",
  ".overview-action-groups",
  ".overview-action-section",
  ".overview-clear-state",
  ".learning-activity-region",
  ".learning-activity-sections",
  ".learning-activity-section",
  ".learning-activity-list",
  ".learning-activity-row",
  ".learning-activity-open",
  ".learning-activity-filters",
  ".history-detail-page-heading",
  ".history-detail-heading-copy",
  ".history-detail-heading-tags",
];

for (const retiredSelector of [
  ".quiz-shell",
  ".quiz-card",
  ".quiz-topline",
  ".quiz-phase",
  ".quiz-direction",
  ".quiz-prior-wrong",
  ".quiz-prompt",
  ".quiz-prompt-row",
  ".choice-row",
  ".choice-list",
  ".choice-audio-placeholder",
  ".pronunciation-button",
  ".timer-warning",
  ".progress-track",
  ".progress-value",
  ".quiz-error",
]) {
  if (css.includes(retiredSelector)) {
    violations.push(
      `globals.css retains migrated quiz player selector ${retiredSelector}`,
    );
  }
}

for (const retiredSelector of retiredActivitySelectors) {
  if (css.includes(retiredSelector)) {
    violations.push(
      `globals.css retains migrated activity selector ${retiredSelector}`,
    );
  }
}

for (const retiredSelector of [
  ".bulk-assignment-form",
  ".bulk-preview-row",
  ".assignment-review-summary",
  ".assignment-dialog-context",
  ".assignment-condition-grid",
  ".assignment-submit-panel",
]) {
  if (css.includes(retiredSelector)) {
    violations.push(`globals.css retains retired assignment selector ${retiredSelector}`);
  }
}

for (const [name, maximum] of Object.entries(cssMaximums)) {
  if (cssMetrics[name] > maximum) {
    violations.push(`${name}: ${cssMetrics[name]} > ${maximum}`);
  }
}

const componentMetrics = legacyComponents.map((contract) => {
  const source = read(contract.path);
  const measured = {
    path: contract.path,
    lines: lineCount(source),
    fetchCalls: count(source, /\bfetch\s*\(/g),
    useStateCalls: count(source, /\buseState\s*(?:<|\()/g),
  };
  for (const [metric, maximum] of [
    ["lines", contract.maxLines],
    ["fetchCalls", contract.maxFetchCalls],
    ["useStateCalls", contract.maxUseStateCalls],
  ]) {
    if (measured[metric] > maximum) {
      violations.push(
        `${contract.path} ${metric}: ${measured[metric]} > ${maximum}`,
      );
    }
  }
  return measured;
});

const assignmentFeatureMetrics = assignmentFeatureContracts.map((contract) => {
  const source = read(contract.path);
  const measured = {
    path: contract.path,
    lines: lineCount(source),
    fetchCalls: count(source, /\bfetch\s*\(/g),
    useStateCalls: count(source, /\buseState\s*(?:<|\()/g),
  };
  for (const [metric, maximum] of [
    ["lines", contract.maxLines],
    ["fetchCalls", contract.maxFetchCalls],
    ["useStateCalls", contract.maxUseStateCalls],
  ]) {
    if (measured[metric] > maximum) {
      violations.push(
        `${contract.path} ${metric}: ${measured[metric]} > ${maximum}`,
      );
    }
  }
  return measured;
});

const studentFeatureMetrics = studentFeatureContracts.map((contract) => {
  const source = read(contract.path);
  const measured = {
    path: contract.path,
    lines: lineCount(source),
    fetchCalls: count(source, /\bfetch\s*\(/g),
    useStateCalls: count(source, /\buseState\s*(?:<|\()/g),
  };
  for (const [metric, maximum] of [
    ["lines", contract.maxLines],
    ["fetchCalls", contract.maxFetchCalls],
    ["useStateCalls", contract.maxUseStateCalls],
  ]) {
    if (measured[metric] > maximum) {
      violations.push(
        `${contract.path} ${metric}: ${measured[metric]} > ${maximum}`,
      );
    }
  }
  return measured;
});

const studentDashboardFeatureMetrics = studentDashboardFeatureContracts.map(
  (contract) => {
    const source = read(contract.path);
    const measured = {
      path: contract.path,
      lines: lineCount(source),
      fetchCalls: count(source, /\bfetch\s*\(/g),
      useStateCalls: count(source, /\buseState\s*(?:<|\()/g),
    };
    for (const [metric, maximum] of [
      ["lines", contract.maxLines],
      ["fetchCalls", contract.maxFetchCalls],
      ["useStateCalls", contract.maxUseStateCalls],
    ]) {
      if (measured[metric] > maximum) {
        violations.push(
          `${contract.path} ${metric}: ${measured[metric]} > ${maximum}`,
        );
      }
    }
    return measured;
  },
);
const quizPlayerFeatureMetrics = quizPlayerFeatureContracts.map(
  (contract) => {
    const source = read(contract.path);
    const measured = {
      path: contract.path,
      lines: lineCount(source),
      fetchCalls: count(source, /\bfetch\s*\(/g),
      useStateCalls: count(source, /\buseState\s*(?:<|\()/g),
    };
    for (const [metric, maximum] of [
      ["lines", contract.maxLines],
      ["fetchCalls", contract.maxFetchCalls],
      ["useStateCalls", contract.maxUseStateCalls],
    ]) {
      if (measured[metric] > maximum) {
        violations.push(
          `${contract.path} ${metric}: ${measured[metric]} > ${maximum}`,
        );
      }
    }
    return measured;
  },
);

for (const relativePath of filesUnder(
  "src/features/students/ui",
  (candidate) => candidate.endsWith(".tsx") && !candidate.endsWith(".test.tsx"),
)) {
  const source = read(relativePath);
  if (
    !relativePath.endsWith("student-directory.tsx") &&
    !relativePath.endsWith("student-wrong-word-panel.tsx") &&
    lineCount(source) > 300
  ) {
    violations.push(`${relativePath} exceeds the 300 line feature UI ceiling`);
  }
  if (/\bfetch\s*\(|["']\/api\//.test(source)) {
    violations.push(`${relativePath} performs transport work inside feature UI`);
  }
  if (
    /\bAssignmentManager\b|\blauncherOnly\b|@\/components\/assignment-manager/.test(
      source,
    )
  ) {
    violations.push(`${relativePath} nests the retired manager boundary`);
  }
}

for (const relativePath of filesUnder(
  "src/features/student-dashboard/ui",
  (candidate) => candidate.endsWith(".tsx") && !candidate.endsWith(".test.tsx"),
)) {
  const source = read(relativePath);
  if (lineCount(source) > 300) {
    violations.push(`${relativePath} exceeds the 300 line feature UI ceiling`);
  }
  if (/\bfetch\s*\(|["']\/api\/|@\/lib\/services\//.test(source)) {
    violations.push(`${relativePath} crosses the student dashboard UI boundary`);
  }
}

for (const relativePath of filesUnder(
  "src/features/quiz-player/ui",
  (candidate) => candidate.endsWith(".tsx") && !candidate.endsWith(".test.tsx"),
)) {
  const source = read(relativePath);
  if (lineCount(source) > 300) {
    violations.push(`${relativePath} exceeds the 300 line feature UI ceiling`);
  }
  if (
    /\bfetch\s*\(|["']\/api\/|@\/lib\/services\/|from ["']next\/navigation["']/.test(
      source,
    )
  ) {
    violations.push(`${relativePath} crosses the quiz player UI boundary`);
  }
}

for (const relativePath of filesUnder(
  "src/features/results/ui",
  (candidate) => candidate.endsWith(".tsx") && !candidate.endsWith(".test.tsx"),
)) {
  const source = read(relativePath);
  if (lineCount(source) > 300) {
    violations.push(`${relativePath} exceeds the 300 line feature UI ceiling`);
  }
  if (/\bfetch\s*\(|["']\/api\/|@\/lib\/services\//.test(source)) {
    violations.push(`${relativePath} crosses the results UI boundary`);
  }
}

const quizAttemptRouteSource = read(
  "src/app/student/(protected)/attempt/[id]/page.tsx",
);
if (
  /quiz-shell|quiz-card|<section|<button/.test(quizAttemptRouteSource)
) {
  violations.push("quiz attempt route retains feature markup or global styling");
}

const studentDashboardPageSource = read(
  "src/app/student/(protected)/page.tsx",
);
if (
  /function AssignmentCard|assignments\.filter|<article|activitySection/.test(
    studentDashboardPageSource,
  )
) {
  violations.push(
    "student dashboard route retains feature classification or card rendering",
  );
}

const assignmentWorkspaceSource = read(
  "src/features/assignments/ui/assignment-workspace.tsx",
);
for (const forbidden of [
  /\/api\/admin\/(?:assignment-capacity|assignments|mixed-assignments)/,
  /features\/assignments\/api\/request-adapters/,
]) {
  if (forbidden.test(assignmentWorkspaceSource)) {
    violations.push(
      `assignment workspace crossed the assignment editor boundary (${forbidden})`,
    );
  }
}

const vocabAssignmentPlannerUiSource = read(
  "src/features/assignments/ui/vocab-assignment-planner.tsx",
);
for (const forbidden of [
  /features\/assignments\/api|\.\.\/api\//,
  /@\/lib\/services\//,
  /\bnew Date\s*\(|\.toISOString\s*\(/,
  /commonInitialDatasetId|toVocabTimeTemplate/,
]) {
  if (forbidden.test(vocabAssignmentPlannerUiSource)) {
    violations.push(
      `vocab assignment UI crossed the replaceable presentation boundary (${forbidden})`,
    );
  }
}

const bulkSeriesPreviewUiSource = read(
  "src/features/assignments/ui/bulk-series-preview.tsx",
);
for (const forbidden of [
  /warning\.kind\s*===\s*["']existing_assignment["']/,
  /warning\.kind\s*===\s*["']planned_series_order["']/,
  /mode:\s*["'](?:skip|move|allow)["']/,
]) {
  if (forbidden.test(bulkSeriesPreviewUiSource)) {
    violations.push(
      `bulk preview UI owns collision policy instead of rendering it (${forbidden})`,
    );
  }
}

const vocabAssignmentDomainSource = read(
  "src/features/assignments/domain/vocab-assignment-plan.ts",
);
for (const forbidden of [
  /from ["']react["']|\buseState\b|\buseEffect\b/,
  /\.\.\/(?:ui|controller|api)\//,
  /@\/lib\/services\/|\bfetch\s*\(/,
]) {
  if (forbidden.test(vocabAssignmentDomainSource)) {
    violations.push(
      `vocab assignment domain crossed the pure calculation boundary (${forbidden})`,
    );
  }
}

for (const relativePath of filesUnder(
  "src/features/assignments/ui",
  (candidate) => candidate.endsWith(".tsx") && !candidate.endsWith(".test.tsx"),
)) {
  const source = read(relativePath);
  if (lineCount(source) > 300) {
    violations.push(`${relativePath} exceeds the 300 line feature UI ceiling`);
  }
  if (/\bfetch\s*\(|["']\/api\//.test(source)) {
    violations.push(`${relativePath} performs transport work inside feature UI`);
  }
}

const componentDirectory = path.join(rootDirectory, "src/components");
for (const name of fs.readdirSync(componentDirectory)) {
  if (!name.endsWith(".tsx")) continue;
  const relativePath = `src/components/${name}`;
  const source = read(relativePath);
  if (!legacyPaths.has(relativePath) && lineCount(source) > 500) {
    violations.push(`${relativePath} exceeds the 500 line ceiling`);
  }
}

const productionTsxPaths = filesUnder(
  "src",
  (relativePath) =>
    relativePath.endsWith(".tsx") &&
    !relativePath.endsWith(".test.tsx") &&
    !relativePath.endsWith(".stories.tsx"),
);
const primitiveDirectoryPrefix = "src/design-system/primitives/";
const designSystemDirectoryPrefix = "src/design-system/";
const dialogPrimitivePath = `${primitiveDirectoryPrefix}dialog/dialog.tsx`;
const tabsPrimitivePath = `${primitiveDirectoryPrefix}tabs/tabs.tsx`;
const tooltipPrimitivePath = `${primitiveDirectoryPrefix}tooltip/help-tip.tsx`;

const centralizedApiContracts = [
  {
    allowedPath: dialogPrimitivePath,
    label: "native dialog API",
    pattern: /<dialog\b|\bshowModal\s*\(|\bHTMLDialogElement\b/,
  },
  {
    allowedPath: tabsPrimitivePath,
    label: "tab semantics",
    pattern: /role=["']tab(?:list)?["']|\baria-selected\s*=/,
  },
  {
    allowedPath: tooltipPrimitivePath,
    label: "popover API",
    pattern: /\bpopover\s*=|\bshowPopover\s*\(|\bhidePopover\s*\(/,
  },
];

for (const relativePath of productionTsxPaths) {
  const source = read(relativePath);
  if (source.includes("/api/admin/review-assignments")) {
    violations.push(
      `${relativePath} calls the retired standalone review assignment endpoint`,
    );
  }
  for (const contract of centralizedApiContracts) {
    if (
      relativePath !== contract.allowedPath &&
      contract.pattern.test(source)
    ) {
      violations.push(
        `${relativePath} uses ${contract.label} outside ${contract.allowedPath}`,
      );
    }
  }
  if (
    /@\/components\/(?:ui-modal|ui-tabs|help-tip)/.test(source)
  ) {
    violations.push(`${relativePath} imports a retired overlay component`);
  }
}

for (const relativePath of productionTsxPaths.filter((candidate) =>
  candidate.startsWith(designSystemDirectoryPrefix),
)) {
  const source = read(relativePath);
  for (const forbidden of [
    /\bfetch\s*\(/,
    /from ["']next\/navigation["']/,
    /from ["']sonner["']/,
    /from ["']@\/lib\/services/,
    /["']\/api\//,
  ]) {
    if (forbidden.test(source)) {
      violations.push(
        `${relativePath} crosses the primitive dependency boundary (${forbidden})`,
      );
    }
  }
}

const boundedCssModulePaths = [
  ...filesUnder(
    "src/design-system",
    (candidate) => candidate.endsWith(".module.css"),
  ),
  ...filesUnder(
    "src/features/history",
    (candidate) => candidate.endsWith(".module.css"),
  ),
  ...filesUnder(
    "src/features/students",
    (candidate) => candidate.endsWith(".module.css"),
  ),
  ...filesUnder(
    "src/features/student-dashboard",
    (candidate) => candidate.endsWith(".module.css"),
  ),
  ...filesUnder(
    "src/features/quiz-player",
    (candidate) => candidate.endsWith(".module.css"),
  ),
  ...filesUnder(
    "src/features/assignments",
    (candidate) => candidate.endsWith(".module.css"),
  ),
  ...filesUnder(
    "src/features/results",
    (candidate) => candidate.endsWith(".module.css"),
  ),
];

for (const relativePath of boundedCssModulePaths) {
  const source = read(relativePath);
  if (/:global\(|#[\da-f]{3,8}\b/i.test(source)) {
    violations.push(
      `${relativePath} bypasses design tokens or its CSS module boundary`,
    );
  }
}

if (violations.length > 0) {
  console.error("UI architecture debt increased:");
  for (const violation of violations) console.error(`- ${violation}`);
  process.exit(1);
}

console.log(
  JSON.stringify(
    {
      status: "ok",
      css: cssMetrics,
      legacyComponents: componentMetrics,
      assignmentFeatures: assignmentFeatureMetrics,
      studentFeatures: studentFeatureMetrics,
      studentDashboardFeatures: studentDashboardFeatureMetrics,
      quizPlayerFeatures: quizPlayerFeatureMetrics,
    },
    null,
    2,
  ),
);
