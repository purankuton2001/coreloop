# keeploop

**毎日戻ってくるプロダクトのための、継続の仕組み。** ストリーク（休息日つき）、上限つきの付与、XP とレベル、同点を正直に扱うランキング、週次リーグ（昇格・降格）、そして「今日送るべき1通」の判定。

文言・保存・配送は持ちません。何を1点と数えるか、日付をどの時間帯で切るか、通知をどの経路で送るかはプロダクトが決めます。このパッケージは、その上に乗る**公平さと節度**だけを持ちます。

[English](README.en.md)

```sh
npm install keeploop
```

依存ゼロ。Node にもブラウザにも載ります。

## 何が入っているか

| モジュール | 関数 | 持っている判断 |
|---|---|---|
| `days` | `dayKey` `isDayKey` `addDays` `diffDays` `weekKey` | 日付は `YYYY-MM-DD` の文字列。時間帯はプロダクトが切る。2月30日は通さない |
| `streak` | `streak(entries, through)` | 日は `count` / `keep` / `break` の3種。今日の未記録は「未確定」であって「途切れ」ではない。休息は記録を守るが増やさない |
| `progress` | `grant` `dailyReward` `levelProgress` | 付与はキーで冪等・上限つき。日次上限。100 ずつ重くなるレベル曲線 |
| `ranking` | `rank` `rankOf` `compareScores` | 同点は同順位、次の順位は飛ぶ（1, 2, 2, 4）。ID で同点を割らない |
| `league` | `createLeague({ tiers, key, groupSize?, slots?, tiebreak? })` → `enroll` `standings` `close` `describe` `rankRoom` | 20 人部屋・週次・上位下位 25%（最大 5 人）が昇降格。5 人未満は動かない。同点は同じ運命 |
| `nudge` | `pickNudge(signals)` | 1 日 1 通。優先順は「記録が途切れそう」＞「リーグの変化」＞「休息／失敗の翌日」。理由を返し、文面は返さない |

## 使い方

### ストリーク

プロダクトの日別記録を 3 種の効果に写して渡します。

```ts
import { streak } from "keeploop";

const entries = days.map((d) => ({
  day: d.date,                                        // "2026-09-08"
  effect: d.result === "win" ? "count" : d.result === "rest" ? "keep" : "break",
}));
const view = streak(entries, today);
// { current: 12, previous: 12, longest: 12, today: "pending", atRisk: true }
```

`atRisk` が真なら、今日中に何かしないと `previous` 日分が消えます。夜のリマインドはこれを見ます。

日付キーが欠ける日を「途切れ」と読むかは `gapBreaks`（既定 true）。毎日必ず記録を書くプロダクト（未報告の日を自分で `break` にするなど）は false にすれば既存の意味を保てます。

### 付与とレベル

```ts
import { grant, dailyReward, levelProgress } from "keeploop";

grant(season.freeze, "wins:7", 1, { cap: 2 });     // 2回目以降は何もしない
grant(season.freeze, "season-pass", 2, { cap: 2 });

dailyReward({ points: 15, limit: 1 }, earnedToday); // 上限に達していれば 0

levelProgress(xp); // { level, levelXp, nextLevelXp, progress }
```

### ランキング

```ts
import { rank, rankOf } from "keeploop";

rank(rows, (r) => r.xp);                          // [{ ...row, rank: 1, tied: true }, ...]
rankOf(others, (r) => [r.streak, r.winRate], [own.streak, own.winRate]); // 連勝→勝率の順で比較
```

### リーグ

```ts
import { createLeague, weekKey } from "keeploop";

type Member = { owner: string; seasonId: string; tier: number; group: number; joinedAt: string };
const league = createLeague<Member>({ tiers: 5, key: (m) => m.owner + ":" + m.seasonId });

const period = { period: weekKey(today), members: [] };
league.enroll(period, candidates, history);        // 席は追加のみ。前回の結果からティアを引き継ぐ
league.standings(period, (m) => pointsThisWeek(m)); // null を返せば「退会済み・順位なし」
league.close(period, score, now.toISOString());     // 週末に確定
league.describe(period, "alice:s1", score, history); // 本人の部屋・順位・昇降格圏・前回の結果
```

ティアの**名前**（ブロンズ、シルバー…）はプロダクトが持ちます。ここにあるのは番号だけです。

### ナッジ

```ts
import { pickNudge } from "keeploop";

const nudge = pickNudge({
  streak: { previous: view.previous, today: "pending", yesterday: "keep" },
  league: { period: "2026-09-07", rank: 18, zone: "demotion" },
  lastTold: season.leagueNotice,
});
// { reason: "streak-at-risk", days: 12, league: { kind: "demotion", rank: 18 } } | ... | null

if (nudge) send(user, render(nudge));  // render はプロダクトの文面、send はプロダクトの配送
```

## 設計の原則

1. **文言を持たない。** 返すのは理由と数字。声はプロダクトのもの
2. **保存しない。** 素の JSON を受け取り、素の JSON を返す。D1 でも Prisma でもメモリでも
3. **配送しない。** LINE もメールも push も知らない
4. **時計と時間帯を持たない。** 日付は文字列キーで受け取る
5. **同点を ID で割らない。** 同じ成果は同じ扱い
6. **2つの実利用が要求していない抽象は作らない。**

## 出自

[protagonist](https://github.com/purankuton2001/protagonist)（90 日の挑戦・LINE 通知・週次リーグ）と [corecord](https://github.com/purankuton2001/core-record)（毎日の対話・XP・累計ランキング）で別々に書かれていた同じ仕組みを切り出したものです。姉妹パッケージの [coreloop](https://github.com/purankuton2001/coreloop) が「掘る→言語化→シェア」のループを扱うのに対し、keeploop は「また明日も来る」ループを扱います。

## 開発

```bash
npm install && npm test && npm run build
```

テストは TypeScript をそのまま実行するため Node 22.6 以上が必要です（配布物 `dist` は Node 20 で動きます）。

## License

MIT
