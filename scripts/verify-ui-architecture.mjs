import fs from "node:fs";
import path from "node:path";

import postcss from "postcss";

const rootDirectory = process.cwd();

function read(relativePath) {
  return fs.readFileSync(path.join(rootDirectory, relativePath), "utf8");
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
  "APP-20260809-07: shared activity rows, statuses, and route detail",
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
  lines: 6831,
  styleRules: 1053,
  selectorContextKeys: 1157,
  duplicateContextKeys: 164,
  duplicateExcess: 211,
  styleDeclarations: 3199,
  mediaBlocks: 29,
  mediaConditions: 13,
  importantDeclarations: 1,
  trackedSectionMarkers: 9,
  untrackedTopLevelComments: 0,
};

const legacyComponents = [
  {
    path: "src/components/assignment-manager.tsx",
    maxLines: 2987,
    maxFetchCalls: 4,
    maxUseStateCalls: 35,
  },
  {
    path: "src/components/bulk-assignment-dialog.tsx",
    maxLines: 808,
    maxFetchCalls: 2,
    maxUseStateCalls: 17,
  },
  {
    path: "src/components/review-assignment-dialog.tsx",
    maxLines: 469,
    maxFetchCalls: 2,
    maxUseStateCalls: 11,
  },
  {
    path: "src/components/student-manager.tsx",
    maxLines: 1884,
    maxFetchCalls: 1,
    maxUseStateCalls: 23,
  },
  {
    path: "src/components/student-wrong-word-panel.tsx",
    maxLines: 1127,
    maxFetchCalls: 4,
    maxUseStateCalls: 15,
  },
  {
    path: "src/components/quiz-player.tsx",
    maxLines: 767,
    maxFetchCalls: 3,
    maxUseStateCalls: 9,
  },
];
const legacyPaths = new Set(
  legacyComponents.map((contract) => contract.path),
);
const primitiveNames = new Set([
  "status-badge.tsx",
  "count-badge.tsx",
  "help-tip.tsx",
  "activity-status-timeline.tsx",
]);
const violations = [];

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

const componentDirectory = path.join(rootDirectory, "src/components");
for (const name of fs.readdirSync(componentDirectory)) {
  if (!name.endsWith(".tsx")) continue;
  const relativePath = `src/components/${name}`;
  const source = read(relativePath);
  if (!legacyPaths.has(relativePath) && lineCount(source) > 500) {
    violations.push(`${relativePath} exceeds the 500 line ceiling`);
  }
  if (name.startsWith("ui-") || primitiveNames.has(name)) {
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
    },
    null,
    2,
  ),
);
