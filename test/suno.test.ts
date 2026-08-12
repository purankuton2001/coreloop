import assert from "node:assert/strict";
import { test } from "node:test";

import { CoreloopError } from "../src/index.ts";
import {
  SUNO_LIMITS,
  checkLyrics,
  formatStylePrompt,
  isSunoUrl,
  parseLyricSections,
  parseSunoUrl,
  stripLyricTags,
  sunoEmbedUrl,
  sunoSongUrl,
} from "../src/suno.ts";

// ---------- style field ----------

test("a style prompt is normalized to comma-separated fragments", () => {
  assert.equal(
    formatStylePrompt("  indie folk ,,\n warm   analog synth \n\n 90 BPM,"),
    "indie folk, warm analog synth, 90 BPM",
  );
});

test("a fragment the model repeated is kept once, in its first position", () => {
  assert.equal(
    formatStylePrompt("male vocal, tape hiss, Male Vocal, close mic"),
    "male vocal, tape hiss, close mic",
  );
});

test("overflow drops whole fragments instead of cutting one in half", () => {
  const style = formatStylePrompt("aaaa, bbbb, cccc, dddd", { limit: 12 });
  assert.equal(style, "aaaa, bbbb");
  assert.ok(style.length <= 12);
});

test("a single fragment over the whole budget is cut at a word boundary", () => {
  const style = formatStylePrompt("warm analog synthesizer pad", { limit: 14 });
  assert.equal(style, "warm analog");
});

test("one unbroken fragment over the budget throws rather than cutting a word", () => {
  assert.throws(
    () => formatStylePrompt("supercalifragilistic", { limit: 5 }),
    (err: unknown) => err instanceof CoreloopError && err.retryable,
    "half a word is what this function promises never to return",
  );
});

test("a limit that is not a usable number falls back to Suno's own", () => {
  const long = Array.from({ length: 40 }, (_, i) => `fragment ${i}`).join(", ");
  for (const limit of [Number.NaN, 0, -10]) {
    // Number(process.env.SOMETHING_UNSET) is NaN, and NaN fails every
    // comparison — the budget would vanish instead of being enforced.
    assert.ok(formatStylePrompt(long, { limit }).length <= SUNO_LIMITS.style, String(limit));
  }
});

test("the default budget is Suno's style limit", () => {
  const style = formatStylePrompt(Array.from({ length: 40 }, (_, i) => `fragment ${i}`).join(", "));
  assert.ok(style.length <= SUNO_LIMITS.style);
  assert.ok(!style.endsWith(","), "a trailing comma would read as an empty fragment");
});

test("a style prompt with nothing in it is a retryable failure, not an empty string", () => {
  try {
    formatStylePrompt("  ,\n , ");
    assert.fail("expected a throw");
  } catch (err) {
    assert.ok(err instanceof CoreloopError);
    assert.equal(err.retryable, true, "an empty style field is worth re-running");
  }
});

// ---------- lyrics ----------

const LYRICS = `[Intro]
hum

[Verse 1]
first line
second line

[Chorus]
the line they never said`;

test("sections come back tagged, numbered and bodied", () => {
  const sections = parseLyricSections(LYRICS);
  assert.deepEqual(
    sections.map((s) => [s.tag, s.name, s.index]),
    [
      ["Intro", "Intro", null],
      ["Verse 1", "Verse", 1],
      ["Chorus", "Chorus", null],
    ],
  );
  assert.equal(sections[1]?.body, "first line\nsecond line");
});

test("text before the first tag is surfaced, not swallowed", () => {
  const { sections, violations } = checkLyrics(`Here are the lyrics:\n\n[Verse]\nline`);
  assert.equal(sections[0]?.tag, null);
  assert.equal(sections[0]?.body, "Here are the lyrics:");
  assert.deepEqual(
    violations.map((v) => v.kind),
    ["untagged-lead"],
  );
});

test("clean lyrics report no violations", () => {
  assert.deepEqual(checkLyrics(LYRICS).violations, []);
});

test("a tag Suno does not know is reported with the tag", () => {
  const { violations } = checkLyrics(`[Verse]\nline\n\n[Guitar Riff]\nnah`);
  assert.deepEqual(violations, [{ kind: "unknown-tag", tag: "Guitar Riff" }]);
});

test("an app that has proven a tag works can allow it", () => {
  const { violations } = checkLyrics(`[Verse]\nline\n\n[Guitar Riff]\nnah`, {
    allow: ["Guitar Riff"],
  });
  assert.deepEqual(violations, []);
});

test("a tag with nothing under it is reported", () => {
  const { violations } = checkLyrics(`[Verse]\nline\n\n[Chorus]\n`);
  assert.deepEqual(violations, [{ kind: "empty-section", tag: "Chorus" }]);
});

test("an empty bracket is not structure either", () => {
  assert.deepEqual(checkLyrics("[   ]\nline").violations, [{ kind: "unknown-tag", tag: "" }]);
});

test("lyrics with no tags at all are reported as one undifferentiated block", () => {
  assert.deepEqual(
    checkLyrics("just some lines\nand more").violations.map((v) => v.kind),
    ["no-sections", "untagged-lead"],
  );
});

test("hyphen and case differences in a known tag are not violations", () => {
  assert.deepEqual(checkLyrics(`[pre chorus]\nline`).violations, []);
});

test("stripping tags leaves the words a share card shows", () => {
  assert.equal(stripLyricTags(LYRICS), "hum\n\nfirst line\nsecond line\n\nthe line they never said");
});

// ---------- the song that comes back ----------

test("a song URL resolves to its id, with or without www and query", () => {
  assert.deepEqual(parseSunoUrl("https://suno.com/song/abc-123"), { songId: "abc-123" });
  assert.deepEqual(parseSunoUrl("  https://www.suno.com/song/abc-123?sh=x  "), {
    songId: "abc-123",
  });
  assert.equal(isSunoUrl("https://suno.com/song/abc-123"), true);
});

test("anything that is not a song URL is rejected", () => {
  for (const url of [
    "https://suno.com/playlist/abc",
    "https://suno.com/@someone",
    "http://suno.com/song/abc",
    "https://notsuno.com/song/abc",
    "abc-123",
    null,
  ]) {
    assert.equal(parseSunoUrl(url), null, String(url));
    assert.equal(isSunoUrl(url), false, String(url));
  }
});

test("an uppercase scheme or host is the same page", () => {
  assert.deepEqual(parseSunoUrl("HTTPS://SUNO.COM/song/abc-123"), { songId: "abc-123" });
  assert.deepEqual(parseSunoUrl("https://suno.com/song/AbC-123"), { songId: "AbC-123" });
});

test("an embed URL comes from either an id or a pasted link", () => {
  assert.equal(sunoEmbedUrl("abc-123"), "https://suno.com/embed/abc-123");
  assert.equal(sunoEmbedUrl("https://suno.com/song/abc-123"), "https://suno.com/embed/abc-123");
  assert.equal(sunoEmbedUrl("https://suno.com/playlist/abc"), null);
  assert.equal(sunoEmbedUrl(""), null);
  assert.equal(sunoSongUrl("abc-123"), "https://suno.com/song/abc-123");
});

test("input that only looks like an id is not pasted into the embed path", () => {
  // A scheme-less paste and a traversal both resolved to a page that is not the
  // song — the outcome parseSunoUrl exists to prevent.
  assert.equal(sunoEmbedUrl("suno.com/song/abc-123"), null);
  assert.equal(sunoEmbedUrl("../../@someone"), null);
  assert.equal(sunoEmbedUrl("abc 123"), null);
});
