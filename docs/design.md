# coreloop 設計

コンセプトと競合分析は [positioning.md](positioning.md)。本書は**中身の設計**を扱う。

## 0. 出自

corecord（Next.js / テキスト面談 → 核の言語化 → 曲）と prepwork-ai-coach
（Vite SPA / 音声面接 → 7軸採点 → 公開プロフィール・シェアカード）の2つを並べて、
共通していた部分を切り出したのが出発点。以降は「2アプリの最大公約数」ではなく、
**ループを他人のプロダクトに埋め込めるようにする**ライブラリとして設計している。

抽出時に見えていた事実（設計の根拠なので残す）:

| 工程 | corecord | prepwork |
|---|---|---|
| ① 素材を整形 | Q&A を `Q:／A:` 文字列に | `transcriptToText` が**4ファイルで重複**。ラベルの表記ゆれがモデルへの入力差になっていた |
| ② プロンプト合成 | `{{answers}}` `{{language}}` 置換＋リファイン節 | 軸一覧・STT 免責・前回サマリの差し込み、`{{topic}}` 置換 |
| ③ スキーマ付き生成 | `generateObject` | `generateObject` / `streamObject` / `generateText+Output.object` の3方式が混在 |
| ④ 出力の修復 | `sanitizeDeep` | clamp・未返却軸の drop・`referenceIndex` の範囲検証 |
| ⑤ 失敗の扱い | 例外そのまま | 1つは型付き例外、1つは `null` 返し、1つは生 Error |

④⑤が両者の資産であり、かつ一番コピペされていた。ここが本パッケージの中心。

## 1. 設計原則

1. **プロダクトの言葉を持たない** — 質問文・評価軸・語彙・コピーを一語も同梱しない。
   受け取るだけ。これは思想であると同時に、外販時に「掘り方＝商品」を守る線でもある
2. **プロバイダを選ばない** — `model` は呼び出し側が渡す。API キーも env も読まない
3. **同型（isomorphic）** — Node にもブラウザにも載る。`node:*` / `next/*` / `import.meta.env` を使わない
4. **壊れた出力を本人のデータにしない** — 未採点は未採点のまま、引用は必ず検証、失敗は型で投げる
5. **2つの実利用が要求していない抽象は作らない**

## 2. モジュール構成

```
coreloop（コア・依存ゼロ / zod・ai は peer）
├─ 土台
│  ├─ text        LocalizedText / pickText / fillTemplate({{x}}) / joinSections
│  ├─ sanitize    sanitizeText / sanitizeDeep
│  ├─ errors      CoreloopError(reason, retryable)
│  ├─ generate    generateStructured / streamStructured（④⑤内蔵の ai SDK ラッパ）
│  ├─ engine      createEngine（model / temperature / onEvent / sanitize を束ねる）
│  └─ registry    createRegistry（id と子idの両方から引ける）
├─ Dig
│  ├─ transcript  TranscriptTurn / visibleTurns / formatTranscript / formatQA
│  ├─ flows       Flow / ClientFlow / toClientFlow（サーバ専用プロンプトの境界）
│  └─ interview   Probe / askNextQuestion（適応的な次の一問）
├─ Verbalize
│  ├─ candidates  candidatesSchema(n) / buildCandidatesPrompt（候補＋リファイン節）
│  ├─ modes       Mode / ClientMode / toClientMode / createModeRegistry
│  ├─ quotes      locateQuote / resolveTurnIndex
│  └─ scoring     axisScoresSchema / normalizeAxisScores / pickImprovedAxis
├─ Brand
│  ├─ handle      createHandlePolicy（予約語→長さ→文字種の順）
│  └─ visibility  defineVisibilityPolicy（既定非公開・未知フィールドは落とす）
├─ Share
│  ├─ share        pickShareMoment（初回 > 伸び > 節目、1つだけ）
│  └─ presentation toQuestionStep / toChoicesStep / toRevealStep / toShareStep
└─ 収益と計測
   ├─ entitlements createEntitlementPolicy / pickPaywallPrompt
   └─ events       createEventRecorder / summarizeFunnel

coreloop/react   useStagedReveal / useTypewriter / useCountUp（react は optional peer）
coreloop/line    renderLineMessages / parseLineEvent（@line/bot-sdk 非依存）
```

## 3. 効いている判断

### 3.1 質問は台本ではなく Probe

固定の質問リストは固定の答え（本人がいつも言っている要約）を返す。だから
`Probe`（その質問が**何を取りに行くか**）だけを持ち、次の一問はモデルが直前の発言に
対して選ぶ。**上限だけはコードで止める** — 自分の予算を判断するモデルは必ず
「もう一問」を見つけ、その時間を払うのは本人だから。

### 3.2 未採点は未採点のまま

スキーマは軸数ぴったりを要求しない（1軸欠けで採点全体が落ちるため）。返ってこなかった
軸は `normalizeAxisScores` が落とす。**中立値で埋めない** — 誰も測っていない 3 は
本物の 3 と区別できず、その上に積まれた平均をすべて汚す。

### 3.3 引用は必ずログに戻す

corecord の `evidence`（逐語引用）と prepwork の `referenceIndex` は同じ問題。
モデルは言い換えを逐語と偽り、存在しない番号を返す。`locateQuote` は逐語一致 →
空白無視の順で探し、無ければ null（＝リンクにせず素のテキストで出す）。

### 3.4 失敗は型で投げる

`not-configured` / `empty-input` / `invalid-contract` / `api-error` の4つ。
再試行して結果が変わりうるのは `api-error` だけ。ダミー結果を返さないのは、
保存された偽の結果が本物と区別できなくなるため。

### 3.5 プロンプトはクライアントに出さない

`toClientFlow` / `toClientMode` が `extractionPrompt`・`profileSchema`・
`buildProfilePrompt` を剥がす。allowlist ではなく rest 分割で剥がすので、
Flow に項目を足しても剥がし忘れが起きない（逆に、足した項目は公開される）。

### 3.6 シェアと課金は競合させない

`pickShareMoment` は1回に1つだけ返し、同じ瞬間を二度勧めない。
`pickPaywallPrompt` は「完成した結果を1回渡す前」「面談の途中」「シェア提示と同時」を
すべて拒否する。拡散はループの燃料で、課金はその後にしか置けない。

### 3.7 チャネルは表示ステップで分ける

`presentation` が「何を見せたいか」を、`line` / `react` が「どう見せるか」を持つ。
LINE のトークでは、レイヤーが1通ずつ届くこと自体が Web の段階リビールに相当する。
LINE 側の上限（クイックリプライ13件・ラベル20字・postback 300バイト）は
アダプタが守る（本番で 400 を踏んで気づくのでは遅い）。

## 4. 共通化しなかったもの

| 対象 | 理由 |
|---|---|
| カード・プロファイル表示の UI 本体 | 意匠と骨格が一体。汎用レンダラにすると両方の品質が落ちる |
| Canvas 描画・PNG 化 | 数行の DOM 依存をコアに入れると同型性（原則3）が壊れる |
| 目標ツリー（vision→月次→週次） | ビジネス側の概念。エンタメ側に持ち込むと語彙が濁る。実装も1つだけ |
| HTTP API クライアント | 片側にしか存在しない。`CoreloopError` の4理由に HTTP の失敗は収まらない |
| プロンプト本文のカタログ | 各プロダクトの資産。MIT で配らない |
| 音声（Vapi/HeyGen）・永続化・認証 | アプリの領分 |

## 5. 既知の残作業

- ケーススタディ（corecord / prepwork の2例）が未執筆（positioning.md §6）
- `events` の送信先 sink（HTTP など）は未提供。今は呼び出し側が保存する
- 1.0 の線引き（API 凍結）はまだ
