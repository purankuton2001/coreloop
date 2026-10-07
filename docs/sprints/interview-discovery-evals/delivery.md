# Delivery — Interview Discovery Agent + Eval

- Repo: `purankuton2001/coreloop`
- Base: `30cf7fe9adadedc3845134b619032d15ef05a107`
- Branch: `codex/interview-discovery-evals`
- 到達点: provider-neutral な discovery interview agent と shadow eval の基盤を追加する。
- 許可範囲: PR 作成まで。main へのマージ・npm publish・CORECORD への vendor 更新は別工程。
- UI: 変更なし。
- CI: `.github/workflows/ci.yml` の Node 20/22/24、peer-ranges、build を必須 gate とする。

| ID | 成果 | 所有パス | 開発前提 | マージ前提 | 状態 |
| --- | --- | --- | --- | --- | --- |
| P1 | Agent / Eval 契約と実装 | `src/interview-agent.ts`, `src/evals.ts`, `src/perspective.ts`, `src/index.ts`, `src/engine.ts` | spec | unit + typecheck | done |
| P2 | 回帰テスト | `test/interview-agent.test.ts`, `test/evals.test.ts`, `test/perspective.test.ts` | P1 API | CI pass | done |
| P3 | 公開ドキュメント | `README.md`, `README.en.md`, `docs/design.md` | P1 contract | docs review | done |

## 検証方針

1. pure normalization で未知 ID・捏造 evidence・rejected lens を除外できること。
2. stop / budget path がモデル無しでも完了し、filled を偽造しないこと。
3. prompt に non-leading / user adoption / no-bigger-is-better の境界が明示されること。
4. Eval は未採点を埋めず、valid evidence のある score だけ集計すること。
5. GitHub Actions の全ジョブを最終 head で確認する。

## 制限

この環境では独立 subagent runtime とローカル GitHub clone が利用できないため、仕様・UX・ペルソナ・QA の役割は親が分離して順に実施する。独立 QA の代替として、実装後に差分を改めて読み直し、GitHub Actions を外部実行証拠として扱う。

## 実装・QA記録

- PR: #11 `feat: add evidence-grounded discovery interview agent and evals`
- 実装内容:
  - 既存 `askNextQuestion()` を維持し、Analyst → Director → Interviewer の高制御pathを追加。
  - lens opening は USER turn の実在引用を必須化し、`signal / adopted / rejected` を分離。
  - rejected lens は再探索せず、plannerの未知ID・空objectiveはgroundedなfallbackへ正規化。
  - Perspective ladder は隣接1段のみ。rejected が同一ladderの open より優先。
  - `stance / time_horizon / scope / responsibility / assumption` を opt-in の質問形テンプレとして追加。1問につき最大1手、多段ジャンプをpromptで禁止。
  - Eval は caller-defined criterion、partial scoring、transcript/artifact引用検証、採点済みcriterionだけのweighted mean。
- 独立 subagent runtime はこのセッションでは利用不可。親が実装者視点とは別に差分を再読し、以下2件を発見・修正:
  1. lens planner が空objectiveを通せる問題 → lens goalへfallback。
  2. 同一Perspective ladderで open が rejected より先に来ると拒否を無視し得る問題 → rejected優先へ変更。
- GitHub Actions run `37637712602`（コードhead `b9e9cf7`）:
  - Node 20: typecheck / compiled test suite / build = success
  - Node 22: typecheck / test / build = success
  - Node 24: typecheck / test / build = success
  - peer-ranges (zod 3 / ai 5): typecheck = success
  - keeploop Node 22/24: typecheck / test / build = success
- UI変更なし。viewport / visual UX review は対象外。
- DB・永続化・本番公開・npm publish・CORECORDへのvendor更新は未実施。

## 振り返り

1. 「社会的な答えが出たか」をrewardにせず、grounded openingを見逃さないことと本人の採用を分離する。
2. 視座を上げる操作は一種類ではない。stance / time / scope / responsibility / assumption を分けると、scope拡張だけを成熟扱いする偏りを避けられる。
3. refusal は単なる低confidenceではなく、次の探索を止める強い状態として扱う。
