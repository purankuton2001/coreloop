// The standard questions each public framework is asked with.
//
// This file is the exception to rule 1, and it is worth being precise about
// which part of the rule it does not break. What stays out of this package is a
// PRODUCT'S OWN wording: its interviewing method, its axes, its vocabulary, the
// order it digs in. What is in here is the question every published version of
// these exercises already asks — "draw your life as a line", "what do you want
// said about you when you are gone" — which nobody owns and every app was
// otherwise rewriting from the same source.
//
// They are DEFAULTS, not fixtures. Every set is a plain object of templates: an
// app replaces one, all of them, or ignores the file entirely, and none of the
// mechanics in frameworks.ts reads from here. Keeping the copy in its own file
// is the point — the shapes stay copy-free, and a product that has its own
// voice throws this away without touching anything that computes.
//
// Placeholders are {{name}} and are filled by renderQuestion. A placeholder
// with no value is left standing rather than blanked, so a question that lost
// its context is visible in a log instead of arriving at a person half-formed.

import { fillTemplate, pickText, type LocalizedText } from "./text.ts";

export type QuestionTemplate = {
  id: string;
  text: LocalizedText;
  /** One line of framing under the question, where a product wants one. */
  hint?: LocalizedText;
  /** Placeholder names this template expects. Documentation, not validation. */
  vars?: readonly string[];
};

export type RenderedQuestion = {
  id: string;
  text: string;
  hint?: string;
};

/** A template in one language, with its placeholders filled. */
export function renderQuestion(
  template: QuestionTemplate,
  locale: string | null | undefined,
  vars: Record<string, string> = {},
): RenderedQuestion {
  const hint = template.hint ? fillTemplate(pickText(template.hint, locale), vars) : undefined;
  return {
    id: template.id,
    text: fillTemplate(pickText(template.text, locale), vars),
    ...(hint ? { hint } : {}),
  };
}

/** Every template in a set, in the order it is written. */
export function questionList(set: Record<string, QuestionTemplate>): QuestionTemplate[] {
  return Object.values(set);
}

// ---------------------------------------------------------------------------
// Life chart
// ---------------------------------------------------------------------------

export const LIFE_CHART_QUESTIONS = {
  draw: {
    id: "draw",
    text: {
      ja: "これまでを一本の線で描いてください。横は時間（年齢でも学年でも構いません）、縦はそのときの充実度です。",
      en: "Draw your life so far as one line. Time runs across; how full or empty it felt runs up and down.",
    },
    hint: {
      ja: "きれいに描かなくて構いません。上がったところと下がったところが分かれば十分です。",
      en: "It does not need to be neat. Where it went up and where it went down is enough.",
    },
  },
  event: {
    id: "event",
    text: {
      ja: "{{at}}のあたりでは何がありましたか。起きた出来事を一つだけ、事実として書いてください。",
      en: "What happened around {{at}}? One thing, as a fact rather than a feeling.",
    },
    vars: ["at"],
  },
  turningPoint: {
    id: "turningPoint",
    text: {
      ja: "{{at}}で線が大きく動いています。何が起きて、そのときあなたは何を考えていましたか。",
      en: "The line moves a long way at {{at}}. What happened, and what were you thinking at the time?",
    },
    vars: ["at"],
  },
  trough: {
    id: "trough",
    text: {
      ja: "一番低かったとき、周りには何と言っていましたか。本当のところは何を思っていましたか。",
      en: "At the lowest point, what were you telling people? What were you actually thinking?",
    },
    hint: {
      ja: "言えなかったことのほうが、たいてい核に近いところにあります。",
      en: "The part you did not say out loud is usually the part closest to the centre.",
    },
  },
  recovery: {
    id: "recovery",
    text: {
      ja: "そこから線が上がり始めたきっかけは何でしたか。誰かの言葉ですか、自分で決めたことですか。",
      en: "What started the line moving back up? Something someone said, or something you decided?",
    },
  },
  flat: {
    id: "flat",
    text: {
      ja: "長く平らなままの時期があります。何も起きなかったのですか、それとも書きにくいことがありましたか。",
      en: "There is a long flat stretch here. Was nothing happening, or was it something hard to put down?",
    },
  },
} as const satisfies Record<string, QuestionTemplate>;

// ---------------------------------------------------------------------------
// Nine-box grid
// ---------------------------------------------------------------------------

export const NINE_BOX_QUESTIONS = {
  centre: {
    id: "centre",
    text: {
      ja: "真ん中に置く一つを決めてください。いま一番叶えたいことでも、自分の核だと思う一言でも構いません。",
      en: "Decide the one thing that goes in the centre — what you most want, or the sentence you think you are.",
    },
  },
  angle: {
    id: "angle",
    text: {
      ja: "「{{centre}}」を成り立たせている要素を、周りの8マスに分けてください。",
      en: "Break \"{{centre}}\" into the eight boxes around it.",
    },
    hint: {
      ja: "8つ埋めるのが目的です。6つで手が止まったところから先が、まだ考えたことのない角度です。",
      en: "Filling all eight is the exercise. Where you stall at six is the angle you have never taken.",
    },
    vars: ["centre"],
  },
  gap: {
    id: "gap",
    text: {
      ja: "「{{centre}}」について、まだ空いているマスが{{count}}個あります。思いつかないのは考えたことがないからですか、避けているからですか。",
      en: "\"{{centre}}\" still has {{count}} empty boxes. Is nothing coming because you have never thought about it, or because you would rather not?",
    },
    vars: ["centre", "count"],
  },
  action: {
    id: "action",
    text: {
      ja: "「{{cell}}」のために、明日からできることを8つ挙げてください。",
      en: "List eight things you could do about \"{{cell}}\", starting tomorrow.",
    },
    hint: {
      ja: "誰が見ても同じ行動になる粒度まで下げてください。「頑張る」は行動ではありません。",
      en: "Small enough that two people would do the same thing. \"Try harder\" is not one.",
    },
    vars: ["cell"],
  },
} as const satisfies Record<string, QuestionTemplate>;

// ---------------------------------------------------------------------------
// Johari window
// ---------------------------------------------------------------------------

export const JOHARI_QUESTIONS = {
  self: {
    id: "self",
    text: {
      ja: "自分に当てはまると思う言葉を選んでください。",
      en: "Choose the words you think describe you.",
    },
  },
  others: {
    id: "others",
    text: {
      ja: "{{who}}に当てはまると思う言葉を選んでください。本人には誰が何を選んだかは分かりません。",
      en: "Choose the words you think describe {{who}}. They will not see who chose what.",
    },
    vars: ["who"],
  },
  blind: {
    id: "blind",
    text: {
      ja: "他の人はあなたを{{traits}}と見ています。あなた自身は選ばなかった言葉です。心当たりはありますか。",
      en: "Other people see you as {{traits}} — words you did not choose yourself. Does any of it land?",
    },
    vars: ["traits"],
  },
  hidden: {
    id: "hidden",
    text: {
      ja: "あなたが選んで、誰も選ばなかったのは{{traits}}でした。見せていないだけですか、それとも見せても伝わっていないですか。",
      en: "You chose {{traits}} and nobody else did. Are you keeping it out of sight, or showing it and not getting through?",
    },
    vars: ["traits"],
  },
} as const satisfies Record<string, QuestionTemplate>;

// ---------------------------------------------------------------------------
// Overlapping circles — Will/Can/Must and the four-circle version
// ---------------------------------------------------------------------------

export const CIRCLE_QUESTIONS = {
  will: {
    id: "will",
    text: {
      ja: "時間もお金も自由だとしたら、何をして過ごしますか。",
      en: "If time and money were not the question, what would you spend your days doing?",
    },
  },
  can: {
    id: "can",
    text: {
      ja: "人から頼まれることは何ですか。自分では簡単だと思っているのに、なぜか感謝されることは。",
      en: "What do people come to you for — the thing you find easy and they thank you for anyway?",
    },
  },
  must: {
    id: "must",
    text: {
      ja: "いまのあなたに求められていること、やらなければいけないことは何ですか。",
      en: "What is being asked of you right now — what do you have to do?",
    },
  },
  worldNeeds: {
    id: "worldNeeds",
    text: {
      ja: "あなたの周りで、誰かが困っていて、まだ誰も引き受けていないことは何ですか。",
      en: "Around you, what is going wrong that nobody has picked up yet?",
    },
  },
  paidFor: {
    id: "paidFor",
    text: {
      ja: "そのうち、お金を払ってでも頼みたいと思われるのはどれですか。",
      en: "Of those, which would someone pay to have done?",
    },
  },
  core: {
    id: "core",
    text: {
      ja: "すべてに重なったのは{{items}}でした。これを真ん中に置いたら、明日の一日は何が変わりますか。",
      en: "{{items}} landed in every circle. If you put that in the centre, what changes about tomorrow?",
    },
    vars: ["items"],
  },
  emptyCore: {
    id: "emptyCore",
    text: {
      ja: "いまは重なっているものがありません。どれか一つを動かせるとしたら、どの円を動かしますか。",
      en: "Nothing overlaps yet. If you could move one circle, which one would you move?",
    },
    hint: {
      ja: "重なりが無いことは失敗ではありません。どれを動かすかを決めるのが、この図の使い道です。",
      en: "An empty middle is not a failure. Deciding which circle moves is what the diagram is for.",
    },
  },
} as const satisfies Record<string, QuestionTemplate>;

// ---------------------------------------------------------------------------
// Perspectives — the eulogy exercise
// ---------------------------------------------------------------------------

export const PERSPECTIVE_QUESTIONS = {
  framing: {
    id: "framing",
    text: {
      ja: "あなたの葬儀に、あなたをよく知っていた人たちが集まっています。その人たちが一人ずつ、あなたについて話します。",
      en: "The people who knew you best are gathered at your funeral, and each of them speaks about you in turn.",
    },
    hint: {
      ja: "何を成し遂げたかではなく、その人たちが何と言うかを想像してください。",
      en: "Not what you achieved — what those people say.",
    },
  },
  statement: {
    id: "statement",
    text: {
      ja: "{{who}}には、あなたのことを何と言われたいですか。",
      en: "What do you want {{who}} to say about you?",
    },
    vars: ["who"],
  },
  gap: {
    id: "gap",
    text: {
      ja: "そう言われるために、今日していることは何ですか。していないことは何ですか。",
      en: "What are you doing today so that gets said? What are you not doing?",
    },
  },
} as const satisfies Record<string, QuestionTemplate>;

/**
 * The viewpoints the eulogy exercise is usually run with. Relationships, not
 * names: a product that knows the person's actual people should use those, and
 * these are what to ask when it does not.
 */
export const PERSPECTIVE_VIEWPOINTS: readonly { id: string; who: LocalizedText }[] = [
  { id: "family", who: { ja: "家族", en: "your family" } },
  { id: "partner", who: { ja: "人生を共にしてきた人", en: "the person you shared your life with" } },
  { id: "closest-friend", who: { ja: "一番古い友人", en: "your oldest friend" } },
  { id: "colleague", who: { ja: "一緒に働いた人", en: "someone you worked with" } },
  { id: "helped", who: { ja: "あなたに助けられた人", en: "someone you helped" } },
];
