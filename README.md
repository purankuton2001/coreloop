# dig-engine

面談の記録を「構造化された言語化」に変えるための、プロダクト非依存のエンジン。
質問文・掘り方の指示・評価軸といった**中身は持たない**。持つのは、それらを扱う骨格だけ。

- 会話ログ／Q&A → プロンプト素材への整形
- `{{placeholder}}` によるプロンプト合成
- zod スキーマ付き生成（1発／ストリーミング）
- **壊れた出力を修復し、失敗を型で返す** — 中立値で埋めて保存しない
- モードのレジストリと、サーバ専用プロンプトをクライアントへ出さない境界
- 候補提示 → 却下 → 再抽出のリファインループ
- 軸採点の正規化（clamp・未採点軸の drop）と、伸びた軸の比較
- 逐語引用を会話ログ上の位置に戻す（`locateQuote`）
- 公開ID の検証ポリシーと、公開粒度の適用（`dig-engine` コア）
- 結果表示の**振る舞い**だけを持つ React フック（`dig-engine/react`、意匠は各アプリ）

設計の背景と、2つのアプリ（corecord / prepwork-ai-coach）から何を共通と見なしたかは
[docs/design.md](docs/design.md) を参照。

MIT License.

## インストール

```bash
npm install dig-engine
```

peer dependencies: `ai` (>=5) と `zod` (^3.23 || ^4)。
LLM プロバイダには依存しない — `model` は呼び出し側が渡す。

## 使い方

### 1. 面談ログを構造化して受け取る

```ts
import { createGoogleGenerativeAI } from "@ai-sdk/google";
import { z } from "zod";
import { formatTranscript, generateStructured, DigError } from "dig-engine";

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
  if (err instanceof DigError && err.retryable) {
    // api-error のときだけ再試行ボタンを出す。
    // not-configured / empty-input は何度押しても同じ。
  }
}
```

### 2. 途中経過を出しながら採点する

```ts
import { axisScoresSchema, formatAxisList, normalizeAxisScores, streamStructured } from "dig-engine";

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
import { buildCandidatesPrompt, candidatesSchema, generateStructured } from "dig-engine";

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
import { createModeRegistry, toClientMode, toClientFlow } from "dig-engine";

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
| errors | `DigError`(`reason` / `retryable`) `isDigError` `isRetryableDigError` |
| generate | `generateStructured` `streamStructured` |
| registry | `createRegistry` `Registry` |
| flows | `Flow` `ClientFlow` `toClientFlow` |
| modes | `Mode` `ClientMode` `toClientMode` `createModeRegistry` `CoreColumns` |
| candidates | `candidatesSchema` `buildCandidatesPrompt` `Candidate` `RefineRound` |
| scoring | `AxisDef` `axisScoresSchema` `normalizeAxisScores` `clampScore` `scoreRatio` `pickImprovedAxis` `formatAxisList` |
| quotes | `locateQuote` `resolveTurnIndex` |
| handle | `createHandlePolicy`（予約語→長さ→文字種の順で判定。メッセージはアプリ側） |
| visibility | `defineVisibilityPolicy` `applyVisibility`（既定非公開・未知フィールドは落とす） |
| react（別エントリ） | `useStagedReveal` `useTypewriter` `useCountUp` |

`DigError.reason` は 4 値: `not-configured` / `empty-input` / `invalid-contract` / `api-error`。
再試行して結果が変わりうるのは `api-error` だけ（＝ `retryable`）。

### 5. 伸びた回だけシェアを勧める

```ts
import { pickImprovedAxis } from "dig-engine";

const improved = pickImprovedAxis(scores, previousScores); // 同一モードの直近と比較する
if (improved) offerShareCard(improved); // 伸びが無い回は null → 出さない
```

毎回シェアを促すと無視されるようになるため、判定は「前回より上がった軸があるか」。
絶対値ではなく伸び幅で選ぶので、低スコアの人にも出せる。カードの描画は各アプリ。

### 6. 引用を会話ログに戻す

```ts
import { locateQuote, resolveTurnIndex } from "dig-engine";

const at = locateQuote(turns, evidence.quote); // 逐語一致 → 空白無視の順で探す
// null なら「引用がログに存在しない」＝リンクにせず素のテキストで出す
const turnIndex = resolveTurnIndex(turns, highlight.referenceIndex); // 範囲外は null
```

### 7. 公開ID と公開粒度

```ts
import { createHandlePolicy, defineVisibilityPolicy } from "dig-engine";

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

### 8. 結果表示の振る舞い（React）

```ts
import { useStagedReveal, useTypewriter, useCountUp } from "dig-engine/react";

const reveal = useStagedReveal(layers.length, { stepMs: 900, enabled: ready });
reveal.isVisible(0); // 1層目が出たか
```

## 設計上の約束

1. プロダクト固有の言葉（質問文・評価軸・語彙）はこのパッケージに入れない
2. プロバイダを選ばない（API キーも env も読まない）
3. Node でもブラウザでも動く（`node:*` / `next/*` / `import.meta.env` を使わない）
4. 2 つ以上の実利用が要求していない抽象は足さない

## 開発

```bash
npm install && npm test && npm run build
```
