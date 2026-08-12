import assert from "node:assert/strict";
import { test } from "node:test";

import {
  toChoicesStep,
  toQuestionStep,
  toRevealStep,
  toShareStep,
  type ChoicesStep,
} from "../src/index.ts";
import {
  LINE_LIMITS,
  encodePostback,
  parseLineEvent,
  renderLineMessages,
} from "../src/line.ts";

// ---------- steps ----------

test("a finished interview produces no question step", () => {
  assert.equal(
    toQuestionStep({ filled: [], probeId: null, question: null, rationale: "", done: true }),
    null,
  );
});

test("questions are skippable by default", () => {
  const step = toQuestionStep({
    filled: [],
    probeId: "origin",
    question: "嗤われてもやめなかったことは？",
    rationale: "",
    done: false,
  });
  assert.equal(step?.id, "origin");
  assert.equal(step?.skippable, true);
});

test("candidates become numbered options with a rejection path", () => {
  const step = toChoicesStep(
    [
      { text: "私は嗤われても作り続ける", angle: "原体験" },
      { text: "私は言い返せなかった言葉を曲にする", angle: "怒り" },
    ],
    { text: "どれが近い？", rejectLabel: "どれも違う" },
  );
  assert.deepEqual(
    step.options.map((o) => o.id),
    ["0", "1"],
  );
  assert.equal(step.options[0]?.sublabel, "原体験");
  assert.equal(step.rejectOption?.id, "reject");

  const noEscape = toChoicesStep([], { text: "x", rejectLabel: null });
  assert.equal(noEscape.rejectOption, undefined);
});

test("empty reveal layers are dropped", () => {
  const step = toRevealStep([
    { id: "story", body: "  物語  " },
    { id: "shadow", body: "   " },
  ]);
  assert.equal(step.layers.length, 1);
  assert.equal(step.layers[0]?.body, "物語");
});

// ---------- LINE rendering ----------

test("a question renders as one text message with a skip quick reply", () => {
  const step = toQuestionStep(
    { filled: [], probeId: "q1", question: "何をやめなかった？", rationale: "", done: false },
    { hint: "雑でいい" },
  );
  const [message] = renderLineMessages(step!, { skipLabel: "とばす" }) as any[];
  assert.equal(message.type, "text");
  assert.ok(message.text.includes("何をやめなかった？"));
  assert.ok(message.text.includes("雑でいい"));
  assert.equal(message.quickReply.items[0].action.data, "cl:skip:q1");
  assert.equal(message.quickReply.items[0].action.label, "とばす");
});

test("choices put the statements in the body and numbers on the buttons", () => {
  const step = toChoicesStep(
    [
      { text: "私は嗤われても作り続ける", angle: "原体験" },
      { text: "私は言い返せなかった言葉を曲にする", angle: "怒り" },
      { text: "私は諦めた自分を許さない", angle: "矛盾" },
    ],
    { id: "c1", text: "どれが近い？", rejectLabel: "どれも違う" },
  );
  const [message] = renderLineMessages(step) as any[];
  assert.ok(message.text.includes("1. 私は嗤われても作り続ける"));
  assert.ok(message.text.includes("（原体験）"));
  assert.deepEqual(
    message.quickReply.items.map((i: any) => i.action.data),
    ["cl:choice:c1:0", "cl:choice:c1:1", "cl:choice:c1:2", "cl:reject:c1"],
  );
  assert.equal(message.quickReply.items[0].action.label, "1");
  assert.equal(
    message.quickReply.items[0].action.displayText,
    "私は嗤われても作り続ける",
    "the thread shows what they chose, not the button number",
  );
});

test("labels are truncated to LINE's limit rather than rejected", () => {
  const step: ChoicesStep = {
    kind: "choices",
    id: "c",
    text: "?",
    options: [],
    rejectOption: { id: "reject", label: "あ".repeat(40) },
  };
  const [message] = renderLineMessages(step) as any[];
  const label = message.quickReply.items[0].action.label;
  assert.equal(label.length, LINE_LIMITS.actionLabel);
  assert.ok(label.endsWith("…"));
});

test("quick replies are capped at 13 items", () => {
  const step = toChoicesStep(
    Array.from({ length: 20 }, (_, i) => ({ text: `候補${i}`, angle: "" })),
    { id: "c", text: "?", rejectLabel: "どれも違う" },
  );
  const [message] = renderLineMessages(step) as any[];
  assert.equal(message.quickReply.items.length, LINE_LIMITS.quickReplyItems);
});

test("a reveal arrives as one bubble per layer, in order", () => {
  const step = toRevealStep([
    { id: "story", title: "物語", body: "あなたは…" },
    { id: "name", title: "二つ名", body: "夜明けの反撃" },
  ]);
  const messages = renderLineMessages(step) as any[];
  assert.equal(messages.length, 2);
  assert.ok(messages[0].text.startsWith("物語"));
  assert.ok(messages[1].text.includes("夜明けの反撃"));
});

test("a share offer carries the image, the url and both answers", () => {
  const step = toShareStep(
    { kind: "improved", reason: "言語化力: 3 → 4", improvement: {} as never },
    {
      id: "s1",
      text: "言語化力が上がった。カードにする？",
      url: "https://example.com/u/koito",
      imageUrl: "https://example.com/card.png",
      acceptLabel: "シェアする",
      declineLabel: "あとで",
    },
  );
  const messages = renderLineMessages(step) as any[];
  assert.equal(messages[0].type, "image");
  assert.ok(messages[1].text.includes("https://example.com/u/koito"));
  assert.deepEqual(
    messages[1].quickReply.items.map((i: any) => i.action.data),
    ["cl:share:s1:1", "cl:share:s1:0"],
  );
});

test("postback data over LINE's limit fails loudly at build time", () => {
  assert.throws(() => encodePostback(["choice", "x".repeat(300), "0"]), /over LINE's 300 limit/);
});

// ---------- LINE parsing ----------

test("postbacks come back as the reply they encode", () => {
  assert.deepEqual(parseLineEvent({ type: "postback", postback: { data: "cl:skip:q1" } }), {
    kind: "skip",
    stepId: "q1",
  });
  assert.deepEqual(parseLineEvent({ type: "postback", postback: { data: "cl:choice:c1:2" } }), {
    kind: "choice",
    stepId: "c1",
    optionId: "2",
  });
  assert.deepEqual(parseLineEvent({ type: "postback", postback: { data: "cl:reject:c1" } }), {
    kind: "reject",
    stepId: "c1",
    feedback: null,
  });
  assert.deepEqual(parseLineEvent({ type: "postback", postback: { data: "cl:share:s1:0" } }), {
    kind: "share",
    stepId: "s1",
    accepted: false,
  });
});

test("free text is an answer whose step the caller decides", () => {
  assert.deepEqual(
    parseLineEvent({ type: "message", message: { type: "text", text: "  中学のとき  " } }),
    { kind: "answer", stepId: null, text: "中学のとき" },
  );
});

test("events from another bot, or with nothing in them, are ignored", () => {
  assert.equal(parseLineEvent({ type: "postback", postback: { data: "other:skip:q1" } }), null);
  assert.equal(parseLineEvent({ type: "message", message: { type: "sticker" } }), null);
  assert.equal(parseLineEvent({ type: "follow" }), null);
  assert.equal(parseLineEvent(null), null);
});

test("a namespaced bot only answers to its own postbacks", () => {
  const data = encodePostback(["skip", "q1"], { namespace: "corecord" });
  assert.equal(data, "corecord:skip:q1");
  assert.deepEqual(parseLineEvent({ type: "postback", postback: { data } }, { namespace: "corecord" }), {
    kind: "skip",
    stepId: "q1",
  });
  assert.equal(parseLineEvent({ type: "postback", postback: { data } }), null);
});
