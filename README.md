# coreloop

[English](README.en.md)

面談の記録を「構造化された言語化」に変えるための、プロダクト非依存のエンジン。
**そのプロダクト固有の中身**（掘り方の指示・評価軸・語彙）は持たない。持つのは骨格と、
誰の資産でもない公開フレームワークの標準の問い（`coreloop/frameworks`）だけ。

- 会話ログ／Q&A → プロンプト素材への整形
- `{{placeholder}}` によるプロンプト合成
- zod スキーマ付き生成（1発／ストリーミング）と、スキーマ無しの素テキスト生成
- モデルを一度だけ束ねる `createEngine`（キーは持たない）
- **壊れた出力を修復し、失敗を型で返す** — 中立値で埋めて保存しない
- モードのレジストリと、サーバ専用プロンプトをクライアントへ出さない境界
- 候補提示 → 却下 → 再抽出のリファインループ
- 軸採点の正規化（clamp・未採点軸の drop）と、伸びた軸の比較
- 逐語引用を会話ログ上の位置に戻す（`locateQuote`）
- 公開ID の検証ポリシーと、公開粒度の適用（`coreloop` コア）
- 結果表示の**振る舞い**だけを持つ React フック（`coreloop/react`、意匠は各アプリ）
- チャネル非依存の表示ステップと、公式LINE アダプタ（`coreloop/line`）
- 成果物を渡す先の入力形式アダプタ — Suno（`coreloop/suno`、詞や作り方は各アプリ）
- 有名な自己分析フレームワークの**構造と標準の問い**（`coreloop/frameworks`）

設計の背景と、2つのアプリ（corecord / prepwork-ai-coach）から何を共通と見なしたかは
[docs/design.md](docs/design.md) を参照。

MIT License.

<p align="center">
  <img src="https://raw.githubusercontent.com/purankuton2001/coreloop/main/docs/hero.svg" alt="バラバラの言い淀みが一つの核に掘り出され、それが広がって次の人の掘るきっかけになる" width="880">
</p>

## インストール

```bash
npm install coreloop
```

peer dependencies: `ai` (>=5) と `zod` (^3.23 || ^4)。
LLM プロバイダには依存しない — `model` は呼び出し側が渡す。

## 使い方

<p align="center">
  <img src="https://raw.githubusercontent.com/purankuton2001/coreloop/main/docs/demo.svg" alt="coreloop のデモ: dig → verbalize → brand → share が端末で走る様子" width="762">
</p>

この録画は作り物ではなく、[`examples/demo.mjs`](examples/demo.mjs) の**実際の出力**です
（台本付きなのはモデルだけ＝キー不要・毎回同じ出力）。手元でも走ります:

```bash
npm run build && npm run demo     # 録画の作り直しは npm run demo:svg / npm run hero:svg
```

### 1. 面談ログを構造化して受け取る

```ts
import { createGoogleGenerativeAI } from "@ai-sdk/google";
import { z } from "zod";
import { formatTranscript, generateStructured, CoreloopError } from "coreloop";

const google = createGoogleGenerativeAI({ apiKey });

const transcript = formatTranscript(turns, {
  labels: { assistant: "面接官", user: "応募者" },
}); // 非finalチャンク・systemターン・空発話は落ちる

try {
  const result = await generateStructured({
    model: google("gemini-2.5-flash"),
    schema: z.object({ summary: z.string(), nextAction: z.string() }),
    system: YOUR_INSTRUCTIONS,
    prompt: transcript,
  });
} catch (err) {
  if (err instanceof CoreloopError && err.retryable) {
    // api-error のときだけ再試行ボタンを出す。
    // not-configured / empty-input は何度押しても同じ。
  }
}
```

同じ `model` を全ルートで書き回すのが面倒なら、一度だけ束ねる:

```ts
import { createEngine } from "coreloop";

export const engine = createEngine({
  model: google("gemini-2.5-flash"),
  onEvent: recorder.record, // 以降の全呼び出しがこのハンドラに流れる
});

await engine.generateStructured({ schema, prompt: transcript }); // model は省略
await engine.askNextQuestion({ instructions, probes, transcript: turns, language: "Japanese" });

// 一箇所だけ別モデルにしたいとき（元の engine は変わらない）
await engine.with({ model: google("gemini-2.5-pro") }).generateStructured({ schema, prompt });
```

束ねるのは**アプリが作ったモデルハンドルだけ**で、API キーでもプロバイダ選択でもない
（設計上の約束2は保たれる）。個別に渡した引数が常に優先。`model` が無いまま呼べば、
今まで通り**呼び出した時点で** `not-configured` を投げる（生成時ではない）。

### 2. 途中経過を出しながら採点する

```ts
import { axisScoresSchema, formatAxisList, normalizeAxisScores, streamStructured } from "coreloop";

const schema = axisScoresSchema(axes).extend({ comment: z.string().min(1).max(800) });

const raw = await streamStructured({
  model: google("gemini-2.5-flash"),
  schema,
  system: `採点項目:\n${formatAxisList(axes)}\n${YOUR_RULES}`,
  prompt: transcript,
  onPartial: (p) => setLiveScores(normalizeAxisScores(axes, p.scores)),
});

const scores = normalizeAxisScores(axes, raw.scores);
// モデルが返さなかった軸は結果に含まれない（既定値で埋めない）。
// 一律 3 点のダミーは本物の採点と区別がつかないまま保存されてしまうため。
```

### 3. 候補を出して、却下されたら掘り直す

```ts
import { buildCandidatesPrompt, candidatesSchema, generateStructured } from "coreloop";

const { candidates } = await generateStructured({
  model,
  schema: candidatesSchema(3),
  prompt: buildCandidatesPrompt({
    instructions: flow.extractionPrompt, // {{answers}} {{language}} を含むあなたの指示
    transcript,
    language: "Japanese",
    refine: feedback ? { feedback, previousCandidates } : undefined,
  }),
});
```

### 4. モードのレジストリとクライアント境界

```ts
import { createModeRegistry, toClientMode, toClientFlow } from "coreloop";

const modes = createModeRegistry([corecordMode], { defaultId: "corecord" });

modes.require("corecord");     // id で引く
modes.byChildId("core-v2");    // flow id から親モードを引く
modes.get(row.modeId);         // 未知 id は defaultId にフォールバック（旧データ用）

// ブラウザへ渡すのは必ずこちら。extractionPrompt / profileSchema /
// buildProfilePrompt は ClientMode に含まれない。
return toClientMode(mode);
```

## API

| モジュール | 主な export |
|---|---|
| text | `LocalizedText` `pickText` `toLocale` `fillTemplate` `joinSections` |
| transcript | `TranscriptTurn` `visibleTurns` `formatTranscript` `formatQA` |
| sanitize | `sanitizeText` `sanitizeDeep` |
| errors | `CoreloopError`(`reason` / `retryable`) `isCoreloopError` `isRetryableError` |
| generate | `generateStructured` `streamStructured` `generateProse` `streamProse`（スキーマ無し） |
| engine | `createEngine`（model / temperature / onEvent / sanitize を束ねる。`with()` で派生） |
| registry | `createRegistry` `Registry` |
| flows | `Flow` `ClientFlow` `toClientFlow` |
| modes | `Mode` `ClientMode` `toClientMode` `createModeRegistry` `CoreColumns` |
| candidates | `candidatesSchema` `buildCandidatesPrompt` `Candidate` `RefineRound` |
| scoring | `AxisDef` `axisScoresSchema` `normalizeAxisScores` `clampScore` `scoreRatio` `pickImprovedAxis` `formatAxisList` |
| quotes | `locateQuote` `resolveTurnIndex` |
| handle | `createHandlePolicy`（予約語→長さ→文字種の順で判定。メッセージはアプリ側） |
| visibility | `defineVisibilityPolicy` `applyVisibility`（既定非公開・未知フィールドは落とす） |
| interview | `Probe` `askNextQuestion` `buildNextQuestionPrompt` `pendingProbes` |
| share | `pickShareMoment`（初回 > 伸び > 節目。同じ瞬間は二度勧めない） |
| events | `createEventRecorder` `summarizeFunnel`（質問ごとのスキップ率・リファイン回数・シェア承諾率） |
| presentation | `toQuestionStep` `toChoicesStep` `toRevealStep` `toShareStep` `StepReply` |
| line（別エントリ） | `renderLineMessages` `parseLineEvent` `encodePostback` `LINE_LIMITS` |
| frameworks（別エントリ） | `renderQuestion` `questionList` `LIFE_CHART_QUESTIONS` `NINE_BOX_QUESTIONS` `JOHARI_QUESTIONS` `CIRCLE_QUESTIONS` `PERSPECTIVE_QUESTIONS` `PERSPECTIVE_VIEWPOINTS` `pickTurningPoints` `normalizeLifeChart` `formatLifeChart` `createNineBox` `expandNineBox` `nineBoxGaps` `nineBoxProgress` `formatNineBox` `johariWindow` `circleOverlaps` `formatPerspectives` |
| suno（別エントリ） | `formatStylePrompt` `checkLyrics` `parseLyricSections` `stripLyricTags` `parseSunoUrl` `sunoEmbedUrl` `SUNO_LIMITS` `SUNO_SECTION_TAGS` |
| react（別エントリ） | `useStagedReveal` `useTypewriter` `useCountUp` |

`CoreloopError.reason` は 4 値: `not-configured` / `empty-input` / `invalid-contract` / `api-error`。
再試行して結果が変わりうるのは `api-error` だけ（＝ `retryable`）。

### 5. 伸びた回だけシェアを勧める

```ts
import { pickImprovedAxis } from "coreloop";

const improved = pickImprovedAxis(scores, previousScores); // 同一モードの直近と比較する
if (improved) offerShareCard(improved); // 伸びが無い回は null → 出さない
```

毎回シェアを促すと無視されるようになるため、判定は「前回より上がった軸があるか」。
絶対値ではなく伸び幅で選ぶので、低スコアの人にも出せる。カードの描画は各アプリ。

### 6. 引用を会話ログに戻す

```ts
import { locateQuote, resolveTurnIndex } from "coreloop";

const at = locateQuote(turns, evidence.quote); // 逐語一致 → 空白無視の順で探す
// null なら「引用がログに存在しない」＝リンクにせず素のテキストで出す
const turnIndex = resolveTurnIndex(turns, highlight.referenceIndex); // 範囲外は null
```

### 7. 公開ID と公開粒度

```ts
import { createHandlePolicy, defineVisibilityPolicy } from "coreloop";

// クライアントの即時バリデーションとサーバの検証で同じポリシーを使う
export const handles = createHandlePolicy({ reserved: ["me", "setup", "admin"] });
handles.check("Koi To"); // → { handle: "koi to", violation: "invalid-characters" }

const visibility = defineVisibilityPolicy({
  displayName: { always: true },
  strengths: { defaultVisible: true },
  scores: {}, // 既定は非公開
});
return visibility.apply(record, settings); // 非公開・未知のフィールドは落ちる
```

### 8. 公式LINE で面談を回す

Web アプリと同じループを、LINE 公式アカウントのトーク上で回せる。
エンジンは「何を見せたいか」をステップとして出し、チャネルが描き方を決める。

```ts
import { toChoicesStep, toQuestionStep } from "coreloop";
import { parseLineEvent, renderLineMessages } from "coreloop/line";

// 出す: 次の一問 → LINE のテキスト＋クイックリプライ（スキップ付き）
const step = toQuestionStep(await askNextQuestion({ ... }), { hint: "雑でいい" });
const messages = step ? renderLineMessages(step, { skipLabel: "とばす" }) : [];

// 候補3つ → 本文に番号付きで並べ、ボタンは番号（ラベル20字制限のため）
renderLineMessages(toChoicesStep(candidates, { text: "どれが近い？", rejectLabel: "どれも違う" }));

// 受ける: webhook イベント → { kind: "choice" | "skip" | "reject" | "share" | "answer" }
const reply = parseLineEvent(event);
```

クイックリプライ13件・ラベル20字・postback 300バイト・本文5000字という LINE の上限は
アダプタ側で守る（ラベルは切り詰め、postback は超過時に例外で落とす）。
`namespace` を渡せば、1つの公式アカウントで複数のループを同居させられる。
`@line/bot-sdk` には依存しない（素のメッセージオブジェクトを返すだけ）。

### 9. 結果表示の振る舞い（React）

```ts
import { useStagedReveal, useTypewriter, useCountUp } from "coreloop/react";

const reveal = useStagedReveal(layers.length, { stepMs: 900, enabled: ready });
reveal.isVisible(0); // 1層目が出たか
```

### 10. 曲にする（Suno アダプタ）

歌詞もスタイルもモデルに書かせる — その**指示**は各アプリの資産なので同梱しない。
`coreloop/suno` が持つのは Suno の**入力形式**だけ。

```ts
import { checkLyrics, formatStylePrompt, parseSunoUrl, sunoEmbedUrl } from "coreloop/suno";

// 歌詞: スキーマを被せる意味が無い出力は素テキストで流す（engine は §1 のもの）
const lyrics = engine.streamProse({ prompt: YOUR_LYRICS_PROMPT });
return lyrics.toTextStreamResponse(); // ルートはそのまま返せる（await した lyrics.text は sanitize 済み）

// スタイル欄: カンマ区切りの断片へ正規化 → 重複を落とす → 200字に収める
const style = formatStylePrompt(raw); // 溢れたら断片ごと捨てる（語の途中で切らない）

// 歌詞: 貼る前にタグを読む
const { sections, violations } = checkLyrics(text);
// no-sections / unknown-tag / empty-section / untagged-lead（＝モデルの前置きが混ざった）

// 戻ってきた URL: 曲ページだけ受け付け、埋め込みへ
parseSunoUrl(input); // playlist や profile は null
sunoEmbedUrl(input); // id でも URL でも可
```

「Max ~200 characters」をプロンプトの英文で伝えるだけでは**何も検証されない** —
溢れた分はサイト側で黙って切られ、本人はどこが落ちたか分からない。LINE アダプタと同じ線で、
**上限と構文はコードが守り、コピー（どう作るかの指示）はアプリに残す**。

### 11. 有名な自己分析フレームワーク（構造だけ）

ライフチャート、9マスの目標シート、ジョハリの窓、Will/Can/Must、
「死んだとき大事な人に何と言われたいか」— どれも公開された手法で、どのアプリも
同じ形を作り直している。だから**形と、その形から出てくる signal** だけを持つ。
**問いは標準テンプレートとして入っています**（ja/en・`{{placeholder}}` 付き）。
入っていないのは「そのプロダクト固有の掘り方」のほうです（原則1）。

```ts
import { pickTurningPoints, expandNineBox, createNineBox, johariWindow, circleOverlaps } from "coreloop/frameworks";

// ライフチャート／モチベーショングラフ／自分史
// 「一番低かったところ」ではなく「一番動いたところ」を返す。平らな区間は本人がいつも
// 言っている要約しか出てこないため。反転（peak/trough）は同じ振れ幅の直線移動より上位。
pickTurningPoints(points, { count: 3, scale: { min: -5, max: 5 } });
// → [{ point, delta: -6, kind: "trough" }, ...] ＝ 掘るべき瞬間
// scale は任意。渡さなければ clamp しない（0〜10 のチャートを勝手に潰さないため）

// 9マス（中心＋8）。価値は空きマスにある — 8つの角度を強制的に埋めさせる形
const sheet = expandNineBox(createNineBox("核", ["技術", null, "人"]));
nineBoxGaps(sheet);      // まだ誰にも考えさせていない角度
nineBoxProgress(sheet);  // { filled, total }。母数は「今埋められるマス」
// 比率は返さない — 角度を1つ足すと空きマスが8増え、作業した瞬間に割合が下がるため。
// 単調に増やしたいアプリは NINE_BOX_CAPACITY(72) を母数にする。表示の判断はアプリ側

// ジョハリの窓（自分では埋められない象限が blind）
johariWindow(selfPicked, othersPicked, wholePool);

// Will/Can/Must も4円の図も同じ算数。core が空なら空のまま返す
circleOverlaps([{ id: "will", items }, { id: "can", items }, { id: "must", items }]);
```

問いはこう使います。signal がそのまま変数になります:

```ts
import { LIFE_CHART_QUESTIONS, NINE_BOX_QUESTIONS, renderQuestion, questionList } from "coreloop/frameworks";

const [turning] = pickTurningPoints(points, { count: 1 });
renderQuestion(LIFE_CHART_QUESTIONS.turningPoint, "ja", { at: String(turning.point.at) });
// → { id: "turningPoint", text: "12で線が大きく動いています。何が起きて、そのとき…" }

renderQuestion(NINE_BOX_QUESTIONS.gap, "ja", { centre: sheet.core.centre, count: String(gaps.length) });
questionList(LIFE_CHART_QUESTIONS); // 書いた順に全部（ウィザードにそのまま流せる）
```

文言を差し替えたいアプリは、同じ `QuestionTemplate` 型のオブジェクトを自前で持てば
そのまま `renderQuestion` に渡せます（計算側は一切テンプレートを参照していません）。

**人生の輪（Wheel of Life）は新しい API を足していません** — 8軸を0〜10で採点する形は
既存の `scoring`（`AxisDef` / `normalizeAxisScores` / `pickImprovedAxis`）そのものです。

9マスの図法は日本では**登録商標として管理されている名称**で広く知られています。
形式自体は公開されたものなので export 名は形（`nineBox`）で表しています。
アプリの UI でその名称を使う場合は協会の使用条件を確認してください。

MBTI / ストレングスファインダー / VIA / エニアグラム のような**専有の測定器**は
入れていません（設問と採点自体がライセンス対象で、MIT で配れるものではない）。

## 設計上の約束

1. プロダクト固有の言葉（質問文・評価軸・語彙）はこのパッケージに入れない
2. プロバイダを選ばない（API キーも env も読まない）
3. Node でもブラウザでも動く（`node:*` / `next/*` / `import.meta.env` を使わない）
4. 2 つ以上の実利用が要求していない抽象は足さない

## 開発

```bash
npm install && npm test && npm run build
```
