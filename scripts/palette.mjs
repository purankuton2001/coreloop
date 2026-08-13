// The colours both recordings are drawn from.
//
// Kept in one file because they have to agree: the hero and the terminal sit
// one after the other in the README, and an accent that changes between them
// reads as two projects rather than one.
//
// Meaning, not decoration:
//   accent  the core, and everything that IS the loop — the scan that digs, the
//           rings it travels on, the rule under the sentence
//   reach   the people it reaches. A second hue on purpose: the core and the
//           audience for it are not the same kind of thing
//   ink/…   type, in three weights of attention

export const PALETTE = {
  // One green, everywhere the accent appears. A scale would be the thing to add
  // if a beat ever needs to sit behind another, but two shades of the same hue
  // doing the same job is just two places to keep in step.
  accent: "#7ee787",

  reach: "#79c0ff",

  bg: "#0d1117",
  bgDeep: "#090c10",
  bgLift: "#161b22",
  edge: "#30363d",
  rule: "#3d444d",

  ink: "#f0f6fc",
  inkBody: "#c9d1d9",
  inkMuted: "#8b949e",
  inkFaint: "#6e7b8b",
  inkGhost: "#4d5866",
};
