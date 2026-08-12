# dig-engine

面談の記録を「構造化された言語化」に変えるための、プロダクト非依存のエンジン。
質問文・掘り方の指示・評価軸といった**中身は持たない**。持つのは、それらを扱う骨格だけ。

- 会話ログ／Q&A → プロンプト素材への整形
- `{{placeholder}}` によるプロンプト合成
- zod スキーマ付き生成（1発／ストリーミング）
- **壊れた出力を修復し、失敗を型で返す** — 中立値で埋めて保存しない
- モードのレジストリと、サーバ専用プロンプトをクライアントへ出さない境界
- 候補提示 → 却下 → 再抽出のリファインループ
- 軸採点の正規化（clamp・未採点軸の drop）

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
| scoring | `AxisDef` `axisScoresSchema` `normalizeAxisScores` `clampScore` `formatAxisList` |

`DigError.reason` は 4 値: `not-configured` / `empty-input` / `invalid-contract` / `api-error`。
再試行して結果が変わりうるのは `api-error` だけ（＝ `retryable`）。

## 設計上の約束

1. プロダクト固有の言葉（質問文・評価軸・語彙）はこのパッケージに入れない
2. プロバイダを選ばない（API キーも env も読まない）
3. Node でもブラウザでも動く（`node:*` / `next/*` / `import.meta.env` を使わない）
4. 2 つ以上の実利用が要求していない抽象は足さない

## 開発

```bash
npm install && npm test && npm run build
```
