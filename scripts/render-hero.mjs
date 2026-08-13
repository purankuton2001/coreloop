// The loop as one picture: docs/hero.svg
//
//   node scripts/render-hero.mjs
//
// What the terminal recording cannot show is WHY the loop is a loop. This is
// that, in four beats on a single canvas:
//
//   scattered   what a person actually says — hedged, half-finished, sideways
//   dug         the model pulls it toward one point
//   core        one sentence they would put their name on
//   spread      it travels, and the people it reaches start their own
//
// Deliberately abstract about the last beat. No follower counts, no share
// numbers, no invented metrics — the rings say "this travels", which is the
// claim, and a made-up 12.4k would be a claim about someone's results.
//
// Pure SVG + CSS keyframes: no script, no external font, so it animates as a
// plain <img> on GitHub and npm, and holds still under prefers-reduced-motion.
// Generated rather than drawn by hand so the timing stays editable in one place.

import { mkdirSync, writeFileSync } from "node:fs";
import { PALETTE } from "./palette.mjs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const target = join(root, "docs", "hero.svg");

// ---------------------------------------------------------------------------
// Stage
// ---------------------------------------------------------------------------

const W = 880;
const H = 460;
const CX = W / 2;
const CY = 214;

const CYCLE = 18; // seconds
const pct = (seconds) => +((seconds / CYCLE) * 100).toFixed(2);

// Deterministic scatter: a regenerated file should be identical to this one.
let seed = 20260813;
const random = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);

// ---------------------------------------------------------------------------
// Beat 1 — what they actually said
// ---------------------------------------------------------------------------

// The raw material of an interview: nobody's first answer is a sentence they
// would publish. These are the shapes it comes out in.
const FRAGMENTS = [
  "everyone laughed",
  "i guess it just stuck",
  "it's not a big deal",
  "i said nothing back",
  "well — kind of",
  "twelve years, maybe",
  "i never told anyone",
  "you know what i mean",
  "anyway",
  "that's just how i am",
  "it sounds stupid",
  "i still think about it",
];

const fragments = FRAGMENTS.map((text, i) => {
  const angle = (i / FRAGMENTS.length) * Math.PI * 2 + random() * 0.5;
  const radius = 150 + random() * 140;
  // Clamped into a safe box: a fragment half off the canvas reads as a bug, and
  // one sitting on the caption band fights the word underneath it.
  const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
  const halfWidth = text.length * 4.1;
  const x = clamp(CX + Math.cos(angle) * radius * 1.45, 24 + halfWidth, W - 24 - halfWidth);
  const y = clamp(CY + Math.sin(angle) * radius * 0.72, 46, H - 118);
  return {
    text,
    x: Math.round(x),
    y: Math.round(y),
    dx: Math.round(CX - x),
    dy: Math.round(CY - y),
    delay: +(random() * 1.1).toFixed(2),
    drift: Math.round(random() * 8 - 4),
  };
});

// ---------------------------------------------------------------------------
// Beat 4 — where it travels
// ---------------------------------------------------------------------------

// What the loop closing actually looks like: somebody the statement reached,
// starting the same way the first person did — mid-sentence and hedging.
const SEED_WORDS = ["i guess…", "well —", "kind of", "anyway", "it's not…"];
let seedsGiven = 0;

const nodes = Array.from({ length: 22 }, (_, i) => {
  const angle = (i / 22) * Math.PI * 2 + 0.35;
  const radius = 168 + (i % 4) * 46 + random() * 26;
  return {
    x: +(CX + Math.cos(angle) * radius * 1.42).toFixed(1),
    y: +(CY + Math.sin(angle) * radius * 0.7).toFixed(1),
    r: +(1.6 + random() * 2.1).toFixed(1),
    delay: +(11.4 + (i % 7) * 0.16 + random() * 0.5).toFixed(2),
    // The outermost ones are the next people: they are where a new dig starts.
    seed: i % 4 === 3 ? SEED_WORDS[seedsGiven++ % SEED_WORDS.length] : null,
  };
});

// ---------------------------------------------------------------------------
// Timeline
// ---------------------------------------------------------------------------

const BEATS = [
  { id: "dig", label: "Dig", note: "one question at a time, aimed at what they just said", at: 0.6 },
  { id: "verbalize", label: "Verbalize", note: "candidates, rejected, dug again — until it is theirs", at: 5.2 },
  { id: "brand", label: "Brand", note: "a sentence they would put their name on", at: 8.6 },
  { id: "share", label: "Share", note: "offered only at a moment that earned it", at: 11.6 },
  { id: "loop", label: "Loop", note: "someone sees it, and starts their own dig", at: 14.4 },
];

const CORE_LINE = "I never said it back. I just kept showing up.";

// ---------------------------------------------------------------------------
// Pieces
// ---------------------------------------------------------------------------

const fragmentKeyframes = fragments
  .map((f, i) => `
    @keyframes frag-${i} {
      0%, ${pct(0.2 + f.delay)}% { opacity: 0; transform: translate(0, 0); }
      ${pct(1.1 + f.delay)}%     { opacity: 0.78; transform: translate(0, 0); }
      ${pct(4.4)}%               { opacity: 0.78; transform: translate(0, ${f.drift}px); }
      ${pct(5.0)}%               { opacity: 0.95; }
      ${pct(7.4)}%               { opacity: 0; transform: translate(${f.dx * 0.62}px, ${f.dy * 0.62}px); }
      100%                       { opacity: 0; transform: translate(${f.dx * 0.62}px, ${f.dy * 0.62}px); }
    }`)
  .join("");

const fragmentNodes = fragments
  .map(
    (f, i) =>
      `  <text class="frag f${i}" x="${f.x}" y="${f.y}" text-anchor="middle">${f.text}</text>`,
  )
  .join("\n");

const fragmentClasses = fragments
  .map((_, i) => `    .f${i} { animation-name: frag-${i}; }`)
  .join("\n");

const nodeMarks = nodes
  .map(
    (n, i) =>
      `  <circle class="node n${i}" cx="${n.x}" cy="${n.y}" r="${n.r}" />` +
      (n.seed
        ? `\n  <text class="seed s${i}" x="${Math.round(Math.max(70, Math.min(W - 70, n.x)))}" y="${Math.round(Math.max(40, Math.min(H - 122, n.y - 14)))}" text-anchor="middle">${n.seed}</text>`
        : ""),
  )
  .join("\n");

const nodeClasses = nodes
  .map(
    (n, i) =>
      `    .n${i} { animation-delay: ${n.delay}s; }` +
      (n.seed ? `\n    .s${i} { animation-delay: ${(n.delay + 2.6).toFixed(2)}s; }` : ""),
  )
  .join("\n");

const beatMarks = BEATS.map(
  (b, i) => `  <g class="beat b${i}">
    <text class="beat-label" x="${CX}" y="${H - 62}" text-anchor="middle">${b.label}</text>
    <text class="beat-note" x="${CX}" y="${H - 40}" text-anchor="middle">${b.note}</text>
  </g>`,
).join("\n");

// Each beat is visible from its own start until the next one begins. Written as
// one keyframe set per beat because the hold differs, and a shared one would
// have to be the shortest of them.
const beatKeyframes = BEATS.map((b, i) => {
  const next = BEATS[i + 1]?.at ?? CYCLE - 0.4;
  return `
    @keyframes beat-in-${i} {
      0%, ${pct(b.at)}%           { opacity: 0; transform: translateY(6px); }
      ${pct(b.at + 0.45)}%        { opacity: 1; transform: translateY(0); }
      ${pct(next - 0.35)}%        { opacity: 1; transform: translateY(0); }
      ${pct(next)}%, 100%         { opacity: 0; transform: translateY(-6px); }
    }`;
}).join("");

const beatAnimations = BEATS.map(
  (_, i) => `    .b${i} { animation-name: beat-in-${i}; }`,
).join("\n");

// ---------------------------------------------------------------------------

const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" role="img" aria-label="coreloop: scattered half-sentences are dug into one core statement, which then spreads and starts someone else's dig">
  <title>coreloop — what a person says, turned into words they would publish, and into the thing that brings the next person in</title>

  <defs>
    <radialGradient id="vignette" cx="50%" cy="46%" r="72%">
      <stop offset="0%" stop-color="#12202a" />
      <stop offset="62%" stop-color="${PALETTE.bg}" />
      <stop offset="100%" stop-color="${PALETTE.bgDeep}" />
    </radialGradient>
    <radialGradient id="halo" cx="50%" cy="50%" r="50%">
      <stop offset="0%" stop-color="${PALETTE.accent}" stop-opacity="0.30" />
      <stop offset="55%" stop-color="${PALETTE.accent}" stop-opacity="0.07" />
      <stop offset="100%" stop-color="${PALETTE.accent}" stop-opacity="0" />
    </radialGradient>
    <filter id="soft" x="-40%" y="-40%" width="180%" height="180%">
      <feGaussianBlur stdDeviation="6" />
    </filter>
  </defs>

  <style>
    text {
      font-family: ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, "Liberation Mono", monospace;
      fill: ${PALETTE.inkBody};
    }
    .frag {
      font-size: 13px;
      fill: ${PALETTE.inkFaint};
      opacity: 0;
      animation-duration: ${CYCLE}s;
      animation-iteration-count: infinite;
      animation-timing-function: cubic-bezier(0.4, 0, 0.2, 1);
    }
${fragmentClasses}

    /* the scan that does the digging */
    .scan {
      stroke: ${PALETTE.accent};
      stroke-width: 1;
      opacity: 0;
      animation: scan ${CYCLE}s linear infinite;
    }
    @keyframes scan {
      0%, ${pct(4.2)}%   { opacity: 0; transform: translateY(-120px); }
      ${pct(4.6)}%       { opacity: 0.55; }
      ${pct(7.2)}%       { opacity: 0.55; transform: translateY(120px); }
      ${pct(7.8)}%, 100% { opacity: 0; transform: translateY(120px); }
    }

    .halo {
      opacity: 0;
      animation: halo ${CYCLE}s ease-out infinite;
      transform-box: fill-box;
      transform-origin: center;
    }
    @keyframes halo {
      0%, ${pct(7.0)}%    { opacity: 0; transform: scale(0.6); }
      ${pct(8.8)}%        { opacity: 1; transform: scale(1); }
      ${pct(15.6)}%       { opacity: 1; transform: scale(1); }
      ${pct(16.8)}%, 100% { opacity: 0; transform: scale(1.04); }
    }

    .core {
      font-size: 21px;
      fill: ${PALETTE.ink};
      letter-spacing: 0.01em;
      opacity: 0;
      animation: core ${CYCLE}s cubic-bezier(0.2, 0.8, 0.2, 1) infinite;
      transform-box: fill-box;
      transform-origin: center;
    }
    @keyframes core {
      0%, ${pct(6.8)}%    { opacity: 0; transform: scale(0.965); }
      ${pct(8.6)}%        { opacity: 1; transform: scale(1); }
      ${pct(15.8)}%       { opacity: 1; transform: scale(1); }
      ${pct(17.0)}%, 100% { opacity: 0; transform: scale(1); }
    }
    .core-mark {
      font-size: 10px;
      fill: ${PALETTE.accent};
      letter-spacing: 0.34em;
      opacity: 0;
      animation: mark ${CYCLE}s ease-out infinite;
    }
    @keyframes mark {
      0%, ${pct(8.2)}%    { opacity: 0; }
      ${pct(9.4)}%        { opacity: 0.9; }
      ${pct(15.8)}%       { opacity: 0.9; }
      ${pct(16.8)}%, 100% { opacity: 0; }
    }

    /* the underline draws itself, left to right, once the sentence lands */
    .rule {
      stroke: ${PALETTE.accent};
      stroke-width: 1.4;
      stroke-dasharray: 420;
      stroke-dashoffset: 420;
      opacity: 0.75;
      animation: draw ${CYCLE}s cubic-bezier(0.2, 0.8, 0.2, 1) infinite;
    }
    @keyframes draw {
      0%, ${pct(8.4)}%    { stroke-dashoffset: 420; opacity: 0; }
      ${pct(9.0)}%        { opacity: 0.75; }
      ${pct(10.6)}%       { stroke-dashoffset: 0; opacity: 0.75; }
      ${pct(15.8)}%       { stroke-dashoffset: 0; opacity: 0.75; }
      ${pct(16.8)}%, 100% { stroke-dashoffset: 0; opacity: 0; }
    }

    /* it travels */
    .ring {
      fill: none;
      stroke: ${PALETTE.accent};
      opacity: 0;
      transform-box: fill-box;
      transform-origin: center;
      animation: ring 4.6s cubic-bezier(0.2, 0.7, 0.3, 1) infinite;
    }
    @keyframes ring {
      0%   { opacity: 0; transform: scale(0.12); }
      12%  { opacity: 0.5; }
      100% { opacity: 0; transform: scale(1.5); }
    }
    .rings { opacity: 0; animation: rings ${CYCLE}s steps(1, end) infinite; }
    @keyframes rings {
      0%, ${pct(11.2)}%   { opacity: 0; }
      ${pct(11.3)}%       { opacity: 1; }
      ${pct(16.4)}%       { opacity: 1; }
      ${pct(16.5)}%, 100% { opacity: 0; }
    }

    .node {
      fill: ${PALETTE.reach};
      opacity: 0;
      animation: node ${CYCLE}s ease-out infinite;
    }
    @keyframes node {
      0%   { opacity: 0; }
      2%   { opacity: 0.95; }
      12%  { opacity: 0.5; }
      26%  { opacity: 0.5; }
      32%  { opacity: 0; }
      100% { opacity: 0; }
    }
    .seed {
      font-size: 11px;
      fill: ${PALETTE.inkMuted};
      opacity: 0;
      animation: seed ${CYCLE}s ease-out infinite;
    }
    @keyframes seed {
      0%   { opacity: 0; }
      3%   { opacity: 0.72; }
      13%  { opacity: 0.72; }
      18%  { opacity: 0; }
      100% { opacity: 0; }
    }
    /* After the shorthands above, never before: the animation shorthand resets the delay. */
${nodeClasses}

    .beat {
      opacity: 0;
      animation-duration: ${CYCLE}s;
      animation-iteration-count: infinite;
      animation-timing-function: cubic-bezier(0.2, 0.8, 0.2, 1);
    }
${beatAnimations}
    .beat-label { font-size: 13px; fill: ${PALETTE.accent}; letter-spacing: 0.32em; }
    .beat-note { font-size: 12px; fill: ${PALETTE.inkMuted}; }

    .wordmark { font-size: 11px; fill: ${PALETTE.inkGhost}; letter-spacing: 0.3em; }

${fragmentKeyframes}
${beatKeyframes}

    @media (prefers-reduced-motion: reduce) {
      .frag, .scan, .halo, .core, .core-mark, .rule, .ring, .rings, .node, .seed, .beat {
        animation: none;
      }
      .frag { opacity: 0.3; }
      .core, .halo, .rings, .node { opacity: 1; }
      .core-mark { opacity: 0.9; }
      .rule { stroke-dashoffset: 0; opacity: 0.75; }
      .b2 { opacity: 1; }
    }
  </style>

  <rect width="${W}" height="${H}" fill="url(#vignette)" />

  <!-- beat 1: what they actually said -->
${fragmentNodes}

  <!-- beat 2: the dig -->
  <line class="scan" x1="120" y1="${CY}" x2="${W - 120}" y2="${CY}" />

  <!-- beat 4: it travels (behind the sentence, so the sentence stays readable) -->
  <g class="rings">
    <circle class="ring" cx="${CX}" cy="${CY}" r="150" style="animation-delay:0s" />
    <circle class="ring" cx="${CX}" cy="${CY}" r="150" style="animation-delay:1.15s" />
    <circle class="ring" cx="${CX}" cy="${CY}" r="150" style="animation-delay:2.3s" />
    <circle class="ring" cx="${CX}" cy="${CY}" r="150" style="animation-delay:3.45s" />
  </g>
${nodeMarks}

  <!-- beat 3: the core -->
  <ellipse class="halo" cx="${CX}" cy="${CY}" rx="330" ry="120" fill="url(#halo)" filter="url(#soft)" />
  <text class="core-mark" x="${CX}" y="${CY - 44}" text-anchor="middle">THE CORE</text>
  <text class="core" x="${CX}" y="${CY}" text-anchor="middle">${CORE_LINE}</text>
  <line class="rule" x1="${CX - 210}" y1="${CY + 22}" x2="${CX + 210}" y2="${CY + 22}" />

${beatMarks}

  <text class="wordmark" x="${CX}" y="${H - 16}" text-anchor="middle">CORELOOP</text>
</svg>
`;

mkdirSync(dirname(target), { recursive: true });
writeFileSync(target, svg);
console.log(
  `docs/hero.svg — ${W}×${H}, ${CYCLE}s loop, ${fragments.length} fragments, ${nodes.length} nodes`,
);
