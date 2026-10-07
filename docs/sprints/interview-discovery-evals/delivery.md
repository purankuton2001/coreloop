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
| P1 | Agent / Eval 契約と実装 | `src/interview-agent.ts`, `src/evals.ts`, `src/index.ts`, `src/engine.ts` | spec | unit + typecheck | in_progress |
| P2 | 回帰テスト | `test/interview-agent.test.ts`, `test/evals.test.ts` | P1 API | CI pass | backlog |
| P3 | 公開ドキュメント | `README.md`, `docs/design.md` | P1 contract | docs review | backlog |

## 検証方針

1. pure normalization で未知 ID・捏造 evidence・rejected lens を除外できること。
2. stop / budget path がモデル無しでも完了し、filled を偽造しないこと。
3. prompt に non-leading / user adoption / no-bigger-is-better の境界が明示されること。
4. Eval は未採点を埋めず、valid evidence のある score だけ集計すること。
5. GitHub Actions の全ジョブを最終 head で確認する。

## 制限

この環境では独立 subagent runtime とローカル GitHub clone が利用できないため、仕様・UX・ペルソナ・QA の役割は親が分離して順に実施する。独立 QA の代替として、実装後に差分を改めて読み直し、GitHub Actions を外部実行証拠として扱う。