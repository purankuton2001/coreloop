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
├─ scoring     AxisDef / axisScoreSchema(axes) / normalizeAxisScores（clamp + 未返却軸の drop）
├─ quotes      locateQuote（逐語引用を会話ログ上の位置に戻す）
├─ handle      createHandlePolicy（公開URL用IDの正規化・検証・予約語）
├─ visibility  defineVisibilityPolicy / applyVisibility（公開粒度の適用）
└─ react       useStagedReveal / useTypewriter / useCountUp（別エントリ・react は optional peer）
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

## 4.5 公開・拡散層(prepwork の `claude/prepwork-student-pl-group-pde77i` ブランチを受けて)

学生 PLG ループのブランチで、prepwork に「公開プロフィール(`/u/:handle`)・シェアカード・
目標ツリー」が入った。corecord には既に Release 層(`/r/[id]` 公開記録・アーティスト名・
レコード番号)があるため、ここで**2つ目の重なり**が生まれる。ただし重なるのは一部だけで、
その線引きを誤ると意匠まで共通化して両方の品質を落とす。

| 要素 | prepwork(PLG ブランチ) | corecord | 判定 |
|---|---|---|---|
| 公開ID の検証 | `publicProfileHandle.ts`(予約語→長さ→文字種の順、**サーバ側と手動同期**と自コメントに明記) | `artistName`(自由文字列)・公開URLは creation id | **共通化する**。純ロジックで、既に2箇所同期問題が発生している |
| 公開粒度 | `show_*` 5種 + `isPublished` + `isIndexable`(既定 noindex、スコアは既定非公開) | `Creation.isPublic` の1フラグ | **共通化する**。「非公開項目をレスポンスから落とす」は `toClientFlow` と同じ漏洩防止の規律 |
| シェアカードの**判定** | `buildShareCard`: 前回比で伸びた軸を選ぶ。伸びが無い回は `null`(毎回勧めない) | なし(核＋二つ名の静的カードを想定) | **一部共通化**。「伸び幅最大の軸を選ぶ」比較ロジックだけ scoring に置く |
| シェアカードの**描画** | Canvas 直描き。コーラル/ミント、`PREPWORK ・ AI面接` のブランド行 | ネオン/volt、レコード番号 | **共通化しない**。カードは意匠そのもの |
| PNG 化・ファイル名 | `canvasToPngBlob` / `shareCardFileName` | 未実装 | **共通化しない**。数行の DOM 依存をコアに持ち込むと §2-3(同型)を壊す |
| 目標ツリー・ミッション | `goalsApi` / `Goals.tsx` | 対応物なし | **入れない**。実利用が1つしかない抽象は作らない(§2-5) |
| API エラー型 | `PublicProfileApiError`(status/code) `GoalsApiError` | なし | 共通化しない。HTTP の失敗は `DigError` の4理由に収まらない |

シェアカードで守るべき規律は描画ではなく判定側にある —
**毎回シェアを促すと無視されるので、伸びた回だけ出す**(prepwork の該当コメント)。
これは corecord の「シェア層と深層の分離」(core-result-design.md 原則8)と同じ発想なので、
`pickImprovedAxis` として比較ロジックだけ切り出し、「出す/出さない」の判断を呼び出し側に返す。

### UI について

両アプリの view 本体(corecord `/r/[id]` の Next サーバコンポーネント、prepwork の
`FeedbackModal`/`ShareCardModal`)は、意匠とレイアウトが骨格と一体化しているため共通化しない。
共通なのは**中身を持たない振る舞い**だけ:

- `useStagedReveal` — corecord の段階リビール(物語→光と影→二つ名)と prepwork の
  「ゴースト行→色付き充填→タイプライタ」は同じ「N個のパートを順に出す」状態機械
- `useTypewriter` / `useCountUp` — prepwork の `FeedbackModal` 内に private 実装がある
- `locateQuote` — corecord の `evidence`(逐語引用)と prepwork の `referenceIndex` は
  どちらも「引用を会話ログ上の位置に戻す」問題。**React 不要**なのでコア側に置く

色・トークン・DOM 構造は各アプリのもの。`react` は optional peer にし、
`dig-engine/react` の別エントリに隔離してコア本体の同型性(Node で動く)を守る。

## 5. やらないこと

- Press 段(曲・ES ドラフト等の成果物生成)の共通化 — corecord 側の判断を踏襲
- UI コンポーネント — 意匠が濃く、汎用化すると品質が落ちる
- プロンプト本文のカタログ化 — 各プロダクトの資産。MIT で配らない
- 音声(Vapi/HeyGen)・永続化・認証 — アプリの領分
