# Interview Discovery Agent + Eval 基盤

## 目的

coreloop の既存 `askNextQuestion()` は、1 回のモデル呼び出しで「会話の分析・次に掘る場所の判断・質問文生成」をまとめて行う。
本スプリントでは既存 API を壊さず、より深い自己理解・未言語化の欲望・任意の拡張可能性を探索できる上位レイヤを追加する。

追加する責務は次の 4 つ。

1. **Analyst** — 本人の発言だけを根拠に、probe の充足と caller-defined lens の opening を抽出する。
2. **Director** — 必須 probe、深掘り、lens 探索、終了のどれを次に行うかを選ぶ。
3. **Interviewer** — Director の目的を、本人に押し付けない 1 問へ変換する。
4. **Evaluator** — 終了済み transcript / 任意成果物を caller-defined rubric で shadow 評価する。\n5. **Perspective ladder（任意）** — self → others → group → system 等の caller-defined 視点を、証拠があるときだけ隣接1段ずつ試せる純粋契約。

CORECORD では将来、`beyond-self`、普遍化、事業スケール、外部評価を外した欲望等を lens / rubric として渡せる。
ただし coreloop 自体にはそれらのプロダクト固有語彙を焼き込まない。

## 非対象

- CORECORD 固有の質問文・社会的欲望・事業欲望の rubric 本文。
- 永続化、DB、認証、ジョブ、sampling、ダッシュボード。
- Mastra / Braintrust 等の eval SaaS SDK への依存。
- 既存 `askNextQuestion()` の置換・削除。
- 「大きい」「社会的」「利他的」な回答を成功条件にすること。
- UI 変更。

## 設計原則

- **大胆に仮説を持てるが、本人の事実へ昇格させない。**
- lens は optional exploration。未充足だから聞くのではなく、本人の発言に opening があるときだけ探索する。
- Analyst の lens opening は、本人の transcript に存在する引用を最低 1 つ持つ。
- opening の状態は `signal | adopted | rejected` を区別する。`adopted` は本人が明示的に受け入れた場合だけ。
- Director は `rejected` lens を再度押さない。
- Interviewer は hypothesis を前提に質問しない。signal は「確認する問い」にする。
- Eval は社会的・大規模な結論そのものを加点しない。rubric は caller が定義し、coreloop は evidence 検証・部分採点・集計のみ持つ。
- Eval の未採点 criterion は既定値で埋めない。
- transcript / artifact の本文をイベントへ自動記録しない。

## API 案

### Discovery

```ts
type InterviewLens = {
  id: string;
  goal: string;
  trigger: string;
  guard?: string;
};

type InterviewOpening = {
  lensId: string;
  status: "signal" | "adopted" | "rejected";
  hypothesis: string;
  confidence: number;
  evidence: InterviewEvidence[];
};

type InterviewAnalysis = {
  filled: string[];
  openings: InterviewOpening[];
  unresolved: string[];
};

type InterviewPlan = {
  action: "deepen" | "cover_probe" | "explore_lens" | "finish";
  probeId: string | null;
  lensId: string | null;
  objective: string | null;
  rationale: string;
};

await runInterviewAgent({
  model,
  instructions,
  probes,
  lenses,
  transcript,
  language,
  maxQuestions,
});
```

個別関数 `analyzeInterview` / `planInterview` / `writeInterviewQuestion` も公開し、アプリ側がモデルやキャッシュ戦略を分離できるようにする。

### Eval

```ts
type InterviewEvalCriterion = {
  id: string;
  description: string;
  weight?: number;
  failureBelow?: number;
};

const report = await evaluateInterview({
  model,
  transcript,
  criteria,
  artifacts: [{ id: "core", text: candidate }],
  instructions: "..."
});
```

評価 evidence は transcript または caller-provided artifact に戻して検証する。
存在しない引用しか持たない score は採用しない。
`overallScore` は実際に採点された criterion の weighted mean のみ。

## 状態・失敗

- `maxQuestions` 到達または `userRequestedStop` はモデルを呼ばず終了する。
- 停止時に未回答 probe を「埋まった」ことにはしない。
- Analyst / Director の未知 ID は落とす。
- Director が存在しない / rejected lens を選んだ場合は安全側へ解決する。
- Interviewer の生成が空なら既存の生成エラー契約に従う。
- Eval の未知 criterion、無効 evidence は保存候補から落とす。
- モデル・API キーは caller が渡す既存原則を維持する。

## UX / ペルソナレビュー

UI 変更はないため viewport / visual review は対象外。

利用者観点では以下を優先する。

- 「社会のためにしたいですよね？」のような結論先行を防ぐ。
- 本人が拒否した方向へ粘着しない。
- 小さな個人的欲望でも完了できる。
- 一方で、本人の発言に広げられる opening がある場合は、安全運転で見逃さない。
- 最終的な仮説の採用権は本人側に残る。

## 受け入れ条件

- **AC-01** 既存 `askNextQuestion()` と型は後方互換で残る。
- **AC-02** Analyst は probe 充足と lens opening を分け、opening は本人発言へ検証可能な evidence を持つ。
- **AC-03** `signal / adopted / rejected` を区別し、未知 lens / evidence の捏造を正規化時に除外する。
- **AC-04** Director は `deepen / cover_probe / explore_lens / finish` を返し、rejected lens を探索対象にしない契約を持つ。
- **AC-05** Interviewer は一問だけを生成し、signal を事実として断定しないルールを prompt に含む。
- **AC-06** budget / user stop はモデル呼び出し前に終了し、未充足 probe を completed 扱いしない。
- **AC-07** Eval は caller-defined rubric、partial scoring、transcript/artifact evidence 検証、weighted mean を提供する。
- **AC-08** Eval 自体は「社会性・大きさ・利他性」を既定の成功条件にしない。
- **AC-09** `createEngine()` から agent と eval を呼べる。root export から各型・関数を利用できる。
- **AC-10** Perspective ladder は隣接1段のみを返し、rejected position では broadening を返さない。\n- **AC-11** 新規 pure contract / prompt builder の unit test、既存 test/typecheck/build の CI が通る。
