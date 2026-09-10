// LINE Messaging API adapter.
//
// In Japan an official LINE account is often the whole product surface: the
// interview happens in a chat thread, the result arrives as a bubble, and the
// share goes back out through the same thread. That channel has hard limits the
// engine has to respect rather than discover in production — quick replies cap
// at 13 items with 20-character labels, postback data at 300 bytes, a text
// message at 5000 characters.
//
// Nothing here depends on @line/bot-sdk: these are plain message objects, which
// the SDK accepts as-is and a bare fetch to the reply endpoint accepts too. The
// transport section at the end IS that bare fetch, plus webhook verification.
//
// Imported from "coreloop/line".

import type { PresentationStep, StepReply } from "./presentation.ts";

/** LINE's own limits. Exceeding any of them is a 400 from the reply endpoint. */
export const LINE_LIMITS = {
  quickReplyItems: 13,
  actionLabel: 20,
  postbackData: 300,
  textLength: 5000,
} as const;

export type LineMessage = Record<string, unknown>;

export type RenderLineOptions = {
  /** Label for the skip quick reply. */
  skipLabel?: string;
  /** Prefix for postback payloads, in case a bot serves more than this loop. */
  namespace?: string;
};

const NAMESPACE = "cl";

function truncate(text: string, max: number): string {
  if (text.length <= max) return text;
  // A cut label must not pretend to be whole — the ellipsis is what tells the
  // person there was more, and it is what tells us the copy needs shortening.
  return `${text.slice(0, Math.max(1, max - 1))}…`;
}

export function encodePostback(
  parts: readonly string[],
  options: { namespace?: string } = {},
): string {
  const data = [options.namespace ?? NAMESPACE, ...parts].join(":");
  if (data.length > LINE_LIMITS.postbackData) {
    throw new Error(
      `coreloop/line: postback data is ${data.length} bytes, over LINE's ${LINE_LIMITS.postbackData} limit. Use shorter step and option ids.`,
    );
  }
  return data;
}

function action(label: string, data: string, displayText?: string): LineMessage {
  return {
    type: "action",
    action: {
      type: "postback",
      label: truncate(label, LINE_LIMITS.actionLabel),
      data,
      ...(displayText ? { displayText: truncate(displayText, 300) } : {}),
    },
  };
}

function textMessage(text: string, quickReplyItems?: LineMessage[]): LineMessage {
  return {
    type: "text",
    text: truncate(text, LINE_LIMITS.textLength),
    ...(quickReplyItems?.length
      ? { quickReply: { items: quickReplyItems.slice(0, LINE_LIMITS.quickReplyItems) } }
      : {}),
  };
}

/**
 * Render one step as LINE messages, ready to pass to the reply/push endpoint.
 *
 * A reveal becomes one message per layer, in order: in a chat thread the
 * arrival of each bubble IS the staged reveal that a web app animates.
 */
export function renderLineMessages(
  step: PresentationStep,
  options: RenderLineOptions = {},
): LineMessage[] {
  const ns = options.namespace;

  switch (step.kind) {
    case "question": {
      const body = step.hint ? `${step.text}\n\n${step.hint}` : step.text;
      const items = step.skippable
        ? [
            action(
              options.skipLabel ?? "Skip",
              encodePostback(["skip", step.id], { namespace: ns }),
            ),
          ]
        : [];
      return [textMessage(body, items)];
    }

    case "choices": {
      // The options go in the body, not only in the quick replies: a 20-char
      // label cannot hold a candidate statement, so the numbers in the text are
      // what the person actually reads and the buttons are how they pick.
      const lines = step.options.map((o, i) =>
        o.sublabel ? `${i + 1}. ${o.label}\n   （${o.sublabel}）` : `${i + 1}. ${o.label}`,
      );
      const items = step.options.map((o, i) =>
        action(`${i + 1}`, encodePostback(["choice", step.id, o.id], { namespace: ns }), o.label),
      );
      if (step.rejectOption) {
        items.push(
          action(
            step.rejectOption.label,
            encodePostback(["reject", step.id], { namespace: ns }),
            step.rejectOption.label,
          ),
        );
      }
      return [textMessage([step.text, "", ...lines].join("\n"), items)];
    }

    case "reveal":
      return step.layers.map((layer) =>
        textMessage(layer.title ? `${layer.title}\n\n${layer.body}` : layer.body),
      );

    case "share": {
      const messages: LineMessage[] = [];
      if (step.imageUrl) {
        messages.push({
          type: "image",
          originalContentUrl: step.imageUrl,
          previewImageUrl: step.imageUrl,
        });
      }
      const body = step.url ? `${step.text}\n${step.url}` : step.text;
      messages.push(
        textMessage(body, [
          action(step.acceptLabel, encodePostback(["share", step.id, "1"], { namespace: ns })),
          action(step.declineLabel, encodePostback(["share", step.id, "0"], { namespace: ns })),
        ]),
      );
      return messages;
    }

    default:
      return [];
  }
}

export type LineWebhookEvent = {
  type?: string;
  replyToken?: string;
  timestamp?: number;
  source?: { type?: string; userId?: string; groupId?: string; roomId?: string };
  postback?: { data?: string };
  message?: { type?: string; text?: string };
};

/**
 * Read an inbound LINE event as a reply to a step.
 *
 * Free text is returned as an answer with a null stepId: in a chat thread the
 * person can type at any time, and only the caller knows which step is open.
 * Anything else (stickers, images, follows) returns null.
 */
export function parseLineEvent(
  event: LineWebhookEvent | null | undefined,
  options: { namespace?: string } = {},
): StepReply | null {
  if (!event) return null;
  const ns = options.namespace ?? NAMESPACE;

  if (event.type === "postback" && typeof event.postback?.data === "string") {
    const [namespace, kind, stepId, value] = event.postback.data.split(":");
    if (namespace !== ns || !kind || !stepId) return null;

    switch (kind) {
      case "skip":
        return { kind: "skip", stepId };
      case "choice":
        return value ? { kind: "choice", stepId, optionId: value } : null;
      case "reject":
        // The reason arrives as the next free-text message; the caller pairs
        // them up. Rejecting without a reason still starts a refine round.
        return { kind: "reject", stepId, feedback: null };
      case "share":
        return { kind: "share", stepId, accepted: value === "1" };
      default:
        return null;
    }
  }

  if (event.type === "message" && event.message?.type === "text") {
    const text = event.message.text?.trim();
    return text ? { kind: "answer", stepId: null, text } : null;
  }

  return null;
}

// ---------- transport ----------
//
// The three calls a LINE bot makes — verify a webhook, reply, push — are one
// fetch each. They live here so an app does not need @line/bot-sdk (whose
// Node-only parts do not run on edge runtimes) and so the same code verifies
// under Node, in tests and inside Cloudflare Workers: Web Crypto only.

/** The reply token LINE Developers' "Verify" button sends; replying to it is a 400. */
export const LINE_VERIFY_REPLY_TOKEN = "00000000000000000000000000000000";

/** The subset of a LINE webhook body a bot reads. */
export type LineWebhookBody = {
  destination?: string;
  events?: LineWebhookEvent[];
};

function toBase64(bytes: ArrayBuffer): string {
  let binary = "";
  for (const b of new Uint8Array(bytes)) binary += String.fromCharCode(b);
  return btoa(binary);
}

/**
 * LINE signs the raw body with the channel secret (HMAC-SHA256, base64) and
 * sends it as `x-line-signature`. Compared in constant time; a missing
 * header or an empty secret is a plain reject.
 */
export async function verifyLineSignature(
  body: string,
  signature: string | null | undefined,
  channelSecret: string,
): Promise<boolean> {
  if (!signature || !channelSecret) return false;
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(channelSecret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const expected = toBase64(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(body)));
  if (expected.length !== signature.length) return false;
  let diff = 0;
  for (let i = 0; i < expected.length; i++) diff |= expected.charCodeAt(i) ^ signature.charCodeAt(i);
  return diff === 0;
}

/** A text message, cut at LINE's limit. */
export function lineText(text: string): LineMessage {
  return { type: "text", text: text.slice(0, LINE_LIMITS.textLength) };
}

export type LineSendResult = { ok: true } | { ok: false; status: number; body: string };

export type LineClientOptions = {
  channelAccessToken: string;
  /** Override for tests or a proxy. Default: https://api.line.me/v2/bot */
  endpoint?: string;
  fetch?: typeof fetch;
};

export type LineClient = {
  /** Reply within the webhook's window. Free of charge; the token is single-use. */
  reply(replyToken: string, messages: LineMessage[]): Promise<LineSendResult>;
  /**
   * Push outside a reply window. Counts against the account's monthly quota.
   * `retryKey` (a UUID) makes a retried delivery idempotent on LINE's side.
   */
  push(to: string, messages: LineMessage[], retryKey?: string): Promise<LineSendResult>;
};

/** LINE accepts at most this many messages in one reply or push. */
export const LINE_MESSAGES_PER_REQUEST = 5;

export function createLineClient(options: LineClientOptions): LineClient {
  const endpoint = (options.endpoint ?? "https://api.line.me/v2/bot").replace(/\/$/, "");
  const doFetch = options.fetch ?? fetch;

  async function send(path: string, payload: Record<string, unknown>, retryKey?: string): Promise<LineSendResult> {
    const res = await doFetch(`${endpoint}${path}`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${options.channelAccessToken}`,
        ...(retryKey ? { "x-line-retry-key": retryKey } : {}),
      },
      body: JSON.stringify(payload),
    });
    if (res.ok) return { ok: true };
    return { ok: false, status: res.status, body: (await res.text()).slice(0, 500) };
  }

  return {
    reply: (replyToken, messages) =>
      send("/message/reply", { replyToken, messages: messages.slice(0, LINE_MESSAGES_PER_REQUEST) }),
    push: (to, messages, retryKey) =>
      send("/message/push", { to, messages: messages.slice(0, LINE_MESSAGES_PER_REQUEST) }, retryKey),
  };
}
