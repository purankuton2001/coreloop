# dig-engine 設計 — 2つのアプリから共通部分を切り出す

対象リポジトリ:

- **corecord**(Next.js / サーバ実行 / 1問1画面のテキスト面談 → 核の言語化 → 曲)
- **prepwork-ai-coach**(React+Vite / ブラウザ実行 / Vapi 音声面接 → 7軸採点・振り返り・成長サマリ)

この2つは「面談の記録を LLM に渡して、構造化された言語化結果を返す」という同じ形をしている。
本パッケージは**その形だけ**を MIT で切り出す。質問文・掘り方の指示・評価軸の中身といった
各プロダクト固有の資産(＝商品性のある部分)は、それぞれのリポジトリに残す。

## 1. 共通部分の言語化

両者を並べると、LLM を呼ぶコードは例外なく次の5工程を踏んでいる。

| 工程 | corecord | prepwork |
|---|---|---|
| ① 素材を整形 | `buildExtractionPrompt` が Q&A を `Q:／A:` 文字列に | `transcriptToText` が `[面接官]／[応募者]` 文字列に(**3ファイルで重複実装**) |
| ② プロンプト合成 | `flow.extractionPrompt` の `{{answers}}` `{{language}}` を置換＋リファイン節を追記 | systemPrompt に軸一覧・STT 免責・前回サマリを差し込み。practice は `{{topic}}` 置換 |
| ③ スキーマ付き生成 | `generateObject` + zod | `generateObject` / `streamObject` / `generateText+Output.object` の3方式が混在 |
| ④ 出力の修復 | `sanitizeDeep`(Gemini の思考区切り除去) | score の clamp、未返却軸の drop、`referenceIndex` の範囲検証、trim |
| ⑤ 失敗の扱い | 例外そのまま | `FeedbackGenerationError`(reason + `retryable`)。他の2つは `null` を返す/生 Error |

④⑤が両者の一番の資産で、かつ一番コピペされている。prepwork の
`generateFeedback.ts` にあるコメント「一律3点のダミーを返すと本物の採点と区別がつかないまま
保存される」は、corecord の `sanitizeDeep` と同じ問題意識(**壊れた LLM 出力をユーザーの
データとして永続化しない**)であり、これはプロダクトに依存しない規律なのでパッケージに入れる。

さらに構造レベルでも共通形がある。

| 構造 | corecord | prepwork |
|---|---|---|
| モードのレジストリ | `MODES` + `getMode/getFlow/getModeByFlowId`(flowId → 親モード解決) | `INTERVIEW_MODES` / `PRACTICE_MODES` の `find()` を各所で直書き、`MODE_AXIS_KEYS` で軸を引く |
| 子IDから親を引く | flowId → Mode | modeId → 軸定義(`getAxesForMode`) |
| プロンプトのクライアント非公開 | `toClientFlow` / `toClientMode` が `extractionPrompt`・スキーマを剥がす | 境界なし(SPA なので systemPrompt がブラウザに出ている) |
| 軸/観点の定義 | なし | `AxisDef` レジストリ + モード別 key 配列 |
| 3候補 → 却下 → 再抽出 | あり(儀式) | なし |

→ **レジストリ**と**クライアント安全境界**は共通化する価値がある(prepwork にとっては
新規導入になるが、規律として輸入する意味がある)。**軸採点**は prepwork 固有だが、
軸のカタログ自体は各アプリの資産なので「軸配列を受けてスキーマを組み、返ってきた値を
正規化する関数」だけを持つ。**3候補+リファイン**は corecord 固有の儀式だが、
「言語化の候補を出して選ばせる」形は prepwork の自己分析にも効くので、
テキストを持たない骨組みとして入れる。

## 2. 設計原則

1. **プロダクトの言葉を持ち込まない** — 「核」「二つ名」「ガクチカ」「就活」はパッケージに一語も出さない。
   corecord の `coreProfileSchema`・フロー本文・`baseExtractionRules`、prepwork の `AXES`・
   `systemPrompt` は各リポジトリに残る(MIT 公開範囲の線引き＝ここ)。
2. **プロバイダ非依存** — `@ai-sdk/google` に依存しない。`model` は呼び出し側が渡す
   (corecord はサーバの env、prepwork は `VITE_GEMINI_API_KEY` と、鍵の出所が違うため)。
3. **同型(isomorphic)** — Node にもブラウザにも載る。`next/*`・`node:*`・`import.meta.env` を使わない。
4. **ストリーミングを一級で扱う** — prepwork は採点の途中経過を UI に出しているので、
   `streamStructured` を最初から入れる(後付けだと呼び出し形が割れる)。
5. **抽象は2つの実利用が要求した分だけ** — Press 段(曲生成 / ES 生成)や UI は入れない。
   corecord の `docs/mode-architecture.md` §9-3「先回り抽象の禁止」をそのまま継承する。

## 3. モジュール構成

```
dig-engine
├─ text        LocalizedText / pickText / fillTemplate({{x}}) / joinSections
├─ transcript  TranscriptTurn / formatTranscript / formatQA
├─ sanitize    sanitizeText / sanitizeDeep（モデル出力のゴミ除去）
├─ errors      DigError(reason, retryable) / isRetryableDigError
├─ generate    generateStructured / streamStructured（④⑤を内蔵した ai SDK ラッパ）
├─ registry    createRegistry（id と 子id の両方から引ける汎用レジストリ）
├─ flows       Flow / ClientFlow / toClientFlow（サーバ専用プロンプトの境界）
├─ modes       Mode / ClientMode / toClientMode / CoreColumns
├─ candidates  candidatesSchema(n) / buildCandidatesPrompt（3候補＋リファイン節）
└─ scoring     AxisDef / axisScoreSchema(axes) / normalizeAxisScores（clamp + 未返却軸の drop）
```

依存: `zod` と `ai` は peerDependencies(両アプリが既に別バージョンで持っているため、
パッケージ側では固定しない)。ランタイム依存はゼロ。

## 4. 各アプリでの取り込み方

### corecord(このパッケージの初回検証)

- `src/lib/llm.ts` のスパイン部分(`sanitizeDeep` / `coreCandidatesSchema` / `buildExtractionPrompt`
  のリファイン合成 / 翻訳プロンプト)→ パッケージへ。llm.ts は `model` の定義だけ残す。
- `src/lib/modes/types.ts` / `registry.ts` → パッケージの `Mode` / `createRegistry` を使う薄い層に。
- `src/lib/flows.ts` の型 → パッケージから re-export。フロー本文は残す。
- 検証条件: `docs/mode-architecture.md` Phase 0 と同じく、**振る舞い不変**で `tsc` と
  `next build` が通ること。

### prepwork-ai-coach(段階導入を推奨。一括置換はしない)

| 置き換え先 | 効果 |
|---|---|
| 3ファイルの `transcriptToText` → `formatTranscript` | 重複解消。`isFinal`/`role !== "system"` のフィルタ規則が一箇所に |
| `generateFeedback` の try/catch と clamp → `streamStructured` + `normalizeAxisScores` | 「未採点軸を既定値で埋めない」規律がライブラリ側で保証される |
| `FeedbackGenerationError` → `DigError` | `growthAssist`(現状 `null` 返し)・`generateReviewHighlights`(生 Error)と失敗の扱いが揃う |
| `INTERVIEW_MODES.find(...)` の直書き → `createRegistry` | modeId 解決が一本化。`getAxesForMode` と同じ引き方になる |

`systemPrompt` の本文・`AXES` の中身は prepwork に残す(パッケージは受け取るだけ)。

## 5. やらないこと

- Press 段(曲・ES ドラフト等の成果物生成)の共通化 — corecord 側の判断を踏襲
- UI コンポーネント — 意匠が濃く、汎用化すると品質が落ちる
- プロンプト本文のカタログ化 — 各プロダクトの資産。MIT で配らない
- 音声(Vapi/HeyGen)・永続化・認証 — アプリの領分
