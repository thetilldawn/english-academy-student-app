import fs from "node:fs";
import path from "node:path";

const cssPath = path.resolve("src/app/globals.css");
let source = fs.readFileSync(cssPath, "utf8").replace(/\r\n?/g, "\n");

const tokens = `:root {
  --paper: #fcfbf7;
  --card: #ffffff;
  --surface: #f1efe6;
  --line: #dedcd1;
  --ink: #1a1a18;
  --muted: #7a786e;
  --dim: #a9a79c;
  --pass: #1a6e33;
  --retry: #b4820a;
  --retry-bar: #f0c419;
  --fail: #b23a2f;
  --ok-bg: #e9f1e7;
  --ok-line: #8cb189;
  --ok-ink: #2c6437;
  --no-bg: #f8e7e3;
  --no-line: #d5a79e;
  --no-ink: #a63b2f;
  --radius-small: 4px;
  --radius: 8px;
  --radius-card: 14px;
  --pad: 22px;
  --gap-title: 18px;
  --shadow: none;
  --font-kr: "Pretendard Variable", Pretendard, -apple-system, system-ui, sans-serif;
  --font-krs: var(--font-serif-kr), serif;
  --font-en: var(--font-serif-en), Georgia, serif;
}`;

source = source.replace(/^:root\s*\{[\s\S]*?\}\r?\n/, `${tokens}\n`);
source = source
  .replaceAll("var(--canvas)", "var(--paper)")
  .replaceAll("var(--green-dark)", "var(--ink)")
  .replaceAll("var(--green-soft)", "var(--surface)")
  .replaceAll("var(--green)", "var(--ink)")
  .replaceAll("var(--blue-soft)", "var(--surface)")
  .replaceAll("var(--blue)", "var(--muted)")
  .replaceAll("var(--orange-soft)", "var(--surface)")
  .replaceAll("var(--orange)", "var(--retry)")
  .replaceAll("var(--red-soft)", "var(--no-bg)")
  .replaceAll("var(--red)", "var(--fail)")
  .replaceAll("var(--radius-large)", "var(--radius-card)")
  .replaceAll("var(--shadow-soft)", "none");

source = source
  .replace(/background:\s*\n\s*radial-gradient[\s\S]*?;/g, "background: var(--paper);")
  .replace(/background:\s*(?:linear|radial)-gradient\([\s\S]*?\);/g, "background: var(--ink);")
  .replace(/^\s*backdrop-filter:[^;]+;\r?\n/gm, "")
  .replace(/\s*box-shadow:\s*[^;]+;/g, "")
  .replace(/^\s*box-shadow\s+\d+ms\s+ease,?\r?\n/gm, "")
  .replace(/font-family:\s*Georgia,\s*serif;/g, "font-family: var(--font-en);")
  .replace(/font-weight:\s*(500|750|760|800|820|850|900);/g, (_, weight) =>
    weight === "500" ? "font-weight: 600;" : "font-weight: 700;",
  );

source = source.replace(/border-radius:\s*([^;]+);/g, (_, rawValue) => {
  const value = rawValue.trim();
  if (value === "0" || value === "50%") return `border-radius: ${value};`;
  if (value.includes("radius-small")) return "border-radius: var(--radius-small);";
  if (value === "inherit" || value.includes("radius-card") || value.includes("radius-large")) {
    return "border-radius: var(--radius-card);";
  }
  if (value.includes("radius")) return "border-radius: var(--radius);";
  const numeric = Number.parseFloat(value);
  if (Number.isFinite(numeric) && numeric <= 7) return "border-radius: var(--radius-small);";
  if (Number.isFinite(numeric) && numeric <= 12) return "border-radius: var(--radius);";
  return "border-radius: var(--radius-card);";
});

const semanticHex = new Map([
  ["#a23d38", "var(--fail)"], ["#d56a35", "var(--retry)"],
  ["#176b52", "var(--pass)"], ["#0f4d3b", "var(--pass)"],
  ["#69a88e", "var(--pass)"], ["#704a1e", "var(--retry)"],
  ["#76401f", "var(--retry)"], ["#d99b95", "var(--no-line)"],
  ["#efc7c3", "var(--no-line)"], ["#f7e1df", "var(--no-bg)"],
]);

const tokenEnd = source.indexOf("}\n") + 2;
const head = source.slice(0, tokenEnd);
let body = source.slice(tokenEnd);
body = body.replace(/#[0-9a-fA-F]{3,8}\b/g, (value) => {
  const normalized = value.toLowerCase();
  const semantic = semanticHex.get(normalized);
  if (semantic) return semantic;
  let hex = normalized.slice(1);
  if (hex.length === 3) hex = hex.split("").map((character) => character.repeat(2)).join("");
  if (hex.length > 6) hex = hex.slice(0, 6);
  const channels = [0, 2, 4].map((offset) => Number.parseInt(hex.slice(offset, offset + 2), 16));
  const luminance = channels.reduce((sum, channel) => sum + channel, 0) / 765;
  if (luminance > 0.94) return "var(--card)";
  if (luminance > 0.82) return "var(--surface)";
  if (luminance > 0.64) return "var(--line)";
  if (luminance > 0.34) return "var(--muted)";
  return "var(--ink)";
});
body = body
  .replace(/rgba?\([^)]*\)/g, "transparent")
  .replace(/rgb\([^)]*\/[^)]*\)/g, "transparent")
  .replace(/color:\s*white;/g, "color: var(--paper);");
source = head + body;

const redesignOverrides = `

/* Final redesign contract: DESIGN_1.md */
html,
body {
  background: var(--paper);
}

body {
  color: var(--ink);
  font-family: var(--font-kr);
  font-size: 13px;
  font-variant-numeric: tabular-nums;
}

h1,
.page-heading h1 {
  font-family: var(--font-krs);
  font-size: 26px;
  font-weight: 700;
  letter-spacing: -0.01em;
}

h2,
h3,
.section-heading,
.assignment-step-heading,
.dialog-heading h2 {
  font-family: var(--font-krs);
  font-weight: 700;
}

.brand-lockup .eyebrow,
.auth-card > .eyebrow,
.page-heading > div > .eyebrow,
.dialog-heading > .eyebrow,
.result-hero > .eyebrow {
  display: none;
}

.page-heading {
  margin-bottom: var(--gap-title);
}

.card,
.section {
  border-color: var(--line);
  background: transparent;
}

.landing-card,
.auth-card,
.dialog,
.quiz-card,
.result-summary,
.attempt-summary {
  border: 1px solid var(--line);
  background: var(--card);
}

.button {
  min-height: 44px;
  border-radius: 0;
  font-family: var(--font-krs);
  font-size: 15px;
  font-weight: 700;
}

.button-primary {
  border-color: var(--ink);
  background: var(--ink);
  color: var(--paper);
}

.button-primary:hover:not(:disabled) {
  background: var(--ink);
  color: var(--paper);
  transform: none;
}

.button-secondary,
.button-quiet {
  border: 1px solid var(--ink);
  background: transparent;
  color: var(--ink);
}

.button-danger {
  border-color: var(--fail);
  background: transparent;
  color: var(--fail);
}

.detail-chip,
.filter-chip {
  border: 0;
  border-radius: var(--radius-small);
  background: var(--surface);
  color: var(--muted);
  font-family: var(--font-kr);
  font-size: 11.5px;
  font-weight: 400;
}

.detail-chip strong,
.detail-chip b,
.filter-chip strong,
.filter-chip b {
  color: var(--ink);
  font-weight: 700;
}

.status-pill {
  flex: 0 0 auto;
  border: 0;
  border-radius: 0;
  background: transparent;
  padding: 0;
  color: var(--dim);
  font-family: var(--font-kr);
  font-size: 12px;
  font-weight: 700;
  text-align: right;
  white-space: nowrap;
}

.status-completed,
.status-passed,
.status-active {
  color: var(--pass);
}

.status-missed,
.status-expired,
.status-failed,
.status-blocked,
.status-wrong {
  color: var(--fail);
}

.status-in_progress,
.status-draft,
.status-cancelled,
.status-deleted {
  color: var(--dim);
}

.assignment-card,
.student-card,
.student-history-row,
.admin-history-row,
.result-question,
.wrong-word-row {
  position: relative;
  border: 0;
  border-left: 4px solid var(--dim);
  border-radius: 0;
  background: transparent;
}

.assignment-card:has(.status-completed),
.student-card:has(.status-active),
.result-question:has(.status-correct),
.admin-history-row:has(.status-completed) {
  border-left-color: var(--pass);
}

.assignment-card:has(.status-missed),
.assignment-card:has(.status-expired),
.result-question:has(.status-wrong),
.wrong-word-row:has(.wrong-level-2),
.admin-history-row:has(.status-missed),
.admin-history-row:has(.status-failed) {
  border-left-color: var(--fail);
}

.wrong-word-row:has(.wrong-level-1),
.quiz-prior-wrong,
.student-history-row:has(.status-in_progress) {
  border-left-color: var(--retry-bar);
}

.wrong-level-1,
.quiz-prior-wrong {
  color: var(--retry);
}

.wrong-level-2,
.quiz-prior-wrong-repeated {
  color: var(--fail);
}

.student-assignment-grid,
.student-card-grid,
.result-question-list,
.admin-history-list,
.student-history-list {
  gap: 12px;
}

.list-title,
.assignment-card h3,
.result-question h3 {
  font-family: var(--font-en);
  font-size: 18px;
  font-weight: 600;
}

.assignment-card .eyebrow,
.result-question .eyebrow,
.list-meta,
.wrong-word-meta {
  color: var(--muted);
  font-family: var(--font-kr);
  font-size: 10.5px;
}

.last-score,
.history-score-pair {
  font-family: var(--font-en);
  font-variant-numeric: tabular-nums;
}

.last-score strong,
.history-score-pair strong {
  color: var(--retry);
}

.choice-list {
  display: flex;
  grid-template-columns: none;
  flex-direction: column;
  gap: 9px;
}

.choice {
  min-height: 54px;
  justify-content: flex-start;
  border: 1px solid var(--line);
  border-radius: var(--radius-card);
  background: var(--card);
  color: var(--ink);
  font-family: var(--font-kr);
  font-size: 15px;
  font-weight: 700;
  text-align: left;
}

.choice--en {
  font-family: var(--font-en);
  font-size: 18px;
  font-weight: 600;
}

.choice-number {
  width: 24px;
  height: 24px;
  flex: 0 0 24px;
  border: 0;
  border-radius: var(--radius);
  background: var(--surface);
  color: var(--muted);
  font-family: var(--font-kr);
  font-size: 12px;
  font-weight: 700;
}

.choice-correct {
  border-color: var(--ok-line);
  background: var(--ok-bg);
  color: var(--ok-ink);
}

.choice-correct .choice-number {
  background: var(--ok-line);
  color: var(--ok-bg);
}

.choice-wrong {
  border-color: var(--no-line);
  background: var(--no-bg);
  color: var(--no-ink);
}

.choice-wrong .choice-number {
  background: var(--no-line);
  color: var(--no-bg);
}

.quiz-shell,
.quiz-card {
  width: min(100%, 620px);
  max-width: 620px;
}

.quiz-direction {
  color: var(--muted);
  font-family: var(--font-en);
  font-size: 11.5px;
  font-weight: 600;
}

.quiz-prompt {
  font-family: var(--font-en);
  font-size: clamp(40px, 7vw, 48px);
  font-weight: 700;
  letter-spacing: -0.4px;
}

.quiz-prompt--ko {
  font-family: var(--font-krs);
  font-size: clamp(30px, 6vw, 40px);
}

.timer {
  color: var(--ink);
  font-family: var(--font-en);
  font-size: 26px;
  font-weight: 700;
  font-variant-numeric: tabular-nums;
}

.timer-warning,
.quiz-card:has(.timer-warning) .progress-value {
  color: var(--fail);
  background: var(--fail);
}

.progress-track {
  height: 2px;
  border-radius: 0;
  background: var(--line);
}

.progress-value {
  height: 2px;
  border-radius: 0;
  background: var(--ink);
}

.admin-nav-link,
.nav-link,
.admin-mobile-nav a,
.admin-tablet-nav a {
  min-height: 44px;
  border-radius: var(--radius-small);
  color: var(--muted);
  font-family: var(--font-krs);
  font-weight: 700;
}

.admin-nav-link[aria-current="page"],
.nav-link[aria-current="page"],
.admin-nav-link.active,
.nav-link.active {
  background: var(--surface);
  color: var(--ink);
}

.field input,
.field select,
.field textarea,
input,
select,
textarea {
  border-color: var(--line);
  border-radius: var(--radius-small);
  background: var(--card);
  color: var(--ink);
}

.help-tip-content {
  border-color: var(--line);
  background: var(--card);
  color: var(--muted);
}

.notice,
.empty-state {
  border-color: var(--line);
  border-radius: var(--radius);
  background: var(--surface);
  color: var(--muted);
}

.notice-error {
  border-color: var(--no-line);
  background: var(--no-bg);
  color: var(--no-ink);
}

.notice-success {
  border-color: var(--ok-line);
  background: var(--ok-bg);
  color: var(--ok-ink);
}

.content.student-content {
  width: min(100%, 900px);
}

@media (prefers-color-scheme: dark) {
  :root {
    --paper: #232220;
    --card: #2c2a27;
    --surface: #302e2b;
    --line: #38362f;
    --ink: #edebe7;
    --muted: #b0ada6;
    --dim: #85827b;
    --pass: #66ce86;
    --retry: #edbe58;
    --retry-bar: #edbe58;
    --fail: #ff7a6e;
    --ok-bg: #25382a;
    --ok-line: #456f4d;
    --ok-ink: #7fdd9a;
    --no-bg: #3c2724;
    --no-line: #78453e;
    --no-ink: #ff948a;
  }
}

@media (max-width: 767px) {
  :root {
    --pad: 18px;
  }

  .choice-list {
    display: flex;
    grid-template-columns: none;
  }
}
`;

source = source.replace(/\n\/\* Final redesign contract: DESIGN_1\.md \*\/[\s\S]*$/, "");
fs.writeFileSync(cssPath, source.trimEnd() + redesignOverrides, "utf8");
