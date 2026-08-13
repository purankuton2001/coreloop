// Turn the demo's real output into the recording in the README.
//
//   npm run build && node scripts/render-demo.mjs
//
// It runs examples/demo.mjs and lays the captured lines out as an animated SVG
// — CSS only, no script, so it animates as a plain <img> on GitHub. The point
// of generating it rather than drawing it is that the picture cannot drift from
// what the package actually prints: change the library, re-run this, and the
// recording either updates or the demo fails first.

import { execFileSync } from "node:child_process";
import { PALETTE } from "./palette.mjs";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const target = join(root, "docs", "demo.svg");

const lines = execFileSync("node", [join(root, "examples", "demo.mjs")], { encoding: "utf8" })
  .replace(/\n+$/, "")
  .split("\n");

// ---------------------------------------------------------------------------
// Layout. Monospace advance at 13px is ~7.8px; everything else follows from it.
// ---------------------------------------------------------------------------

const CHAR = 7.8;
const LINE_HEIGHT = 18;
const FONT_SIZE = 13;
const PAD_X = 22;
const PAD_TOP = 46; // room for the title bar
const PAD_BOTTOM = 20;
const COLUMNS = Math.max(...lines.map((l) => [...l].length));

const width = Math.round(COLUMNS * CHAR + PAD_X * 2);
const height = PAD_TOP + lines.length * LINE_HEIGHT + PAD_BOTTOM;

const STEP = 0.26; // seconds between lines
const HOLD = 3.2; // seconds the finished screen stays up
const CYCLE = +(lines.length * STEP + HOLD).toFixed(2);

const escape = (s) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

/**
 * Colour comes from the shape of the line, which is why the demo prints a fixed
 * label column: a section rule, a label, its value, and any continuation row.
 */
const lastContent = lines.reduce((last, line, i) => (line.trim() ? i : last), 0);

function spans(line, index) {
  // The first and last lines are the banner either side of the run.
  if (index === 0 || index === lastContent) return `<tspan class="head">${escape(line)}</tspan>`;

  const rule = /^(\s*── )(.+?)( ─+)$/.exec(line);
  if (rule) {
    return (
      `<tspan class="rule">${escape(rule[1])}</tspan>` +
      `<tspan class="section">${escape(rule[2])}</tspan>` +
      `<tspan class="rule">${escape(rule[3])}</tspan>`
    );
  }

  // A labelled line is one the demo laid out in its fixed columns: two spaces,
  // a ten-wide label, a space, then the value. Matching on the columns rather
  // than on whitespace keeps prose lines from having their first two words
  // painted as a label.
  const labelled = line.length > 13 && line[2] !== " " && line[12] === " "
    ? [line, line.slice(0, 2), line.slice(2, 12).trimEnd(), " ".repeat(11 - line.slice(2, 12).trimEnd().length), line.slice(13)]
    : null;
  if (labelled) {
    return (
      `<tspan>${escape(labelled[1])}</tspan>` +
      `<tspan class="label">${escape(labelled[2])}</tspan>` +
      `<tspan>${escape(labelled[3])}</tspan>` +
      `<tspan class="value">${escape(labelled[4])}</tspan>`
    );
  }

  return `<tspan class="cont">${escape(line)}</tspan>`;
}

const body = lines
  .map((line, i) => {
    const y = PAD_TOP + i * LINE_HEIGHT;
    const delay = (i * STEP).toFixed(2);
    return `  <text class="l" style="animation-delay:${delay}s" x="${PAD_X}" y="${y}" xml:space="preserve">${spans(line, i)}</text>`;
  })
  .join("\n");

const cursorY = PAD_TOP + lines.length * LINE_HEIGHT - 10;

const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" width="${width}" height="${height}" role="img" aria-label="coreloop demo: the loop running in a terminal">
  <title>coreloop — dig, verbalize, brand, share</title>
  <style>
    .bg { fill: ${PALETTE.bg}; }
    .chrome { fill: ${PALETTE.bgLift}; }
    .edge { fill: none; stroke: ${PALETTE.edge}; stroke-width: 1; }
    text {
      font-family: ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, "Liberation Mono", monospace;
      font-size: ${FONT_SIZE}px;
      fill: ${PALETTE.inkBody};
      dominant-baseline: middle;
    }
    .title { fill: ${PALETTE.inkMuted}; font-size: 11px; letter-spacing: 0.08em; }
    .head { fill: ${PALETTE.ink}; font-weight: 600; letter-spacing: 0.04em; }
    .rule { fill: ${PALETTE.rule}; }
    .section { fill: ${PALETTE.accent}; letter-spacing: 0.06em; }
    .label { fill: ${PALETTE.reach}; }
    .value { fill: ${PALETTE.inkBody}; }
    .cont { fill: ${PALETTE.inkMuted}; }
    .l { opacity: 0; animation: appear ${CYCLE}s steps(1, end) infinite; }
    @keyframes appear {
      0% { opacity: 0; }
      0.8% { opacity: 1; }
      ${(((CYCLE - 0.4) / CYCLE) * 100).toFixed(1)}% { opacity: 1; }
      ${(((CYCLE - 0.2) / CYCLE) * 100).toFixed(1)}% { opacity: 0; }
      100% { opacity: 0; }
    }
    .cursor { fill: ${PALETTE.accentBright}; animation: blink 1.06s steps(1, end) infinite; }
    @keyframes blink { 0%, 50% { opacity: 1; } 50.01%, 100% { opacity: 0; } }
    @media (prefers-reduced-motion: reduce) {
      .l { opacity: 1; animation: none; }
      .cursor { animation: none; }
    }
  </style>

  <rect class="bg" width="${width}" height="${height}" rx="10" />
  <rect class="chrome" width="${width}" height="30" rx="10" />
  <rect class="chrome" y="20" width="${width}" height="10" />
  <rect class="edge" x="0.5" y="0.5" width="${width - 1}" height="${height - 1}" rx="10" />
  <circle cx="18" cy="15" r="4.5" fill="#ff5f57" />
  <circle cx="34" cy="15" r="4.5" fill="#febc2e" />
  <circle cx="50" cy="15" r="4.5" fill="#28c840" />
  <text class="title" x="70" y="15">node examples/demo.mjs</text>

${body}

  <rect class="cursor" x="${PAD_X}" y="${cursorY}" width="7" height="14" />
</svg>
`;

mkdirSync(dirname(target), { recursive: true });
writeFileSync(target, svg);
console.log(`docs/demo.svg — ${lines.length} lines, ${width}×${height}, ${CYCLE}s loop`);
