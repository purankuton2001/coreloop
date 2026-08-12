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
// the SDK accepts as-is and a bare fetch to the reply endpoint accepts too.
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
