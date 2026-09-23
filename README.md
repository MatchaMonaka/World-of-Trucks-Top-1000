# World of Trucks Leaderboard (Top 1000)

[World of Trucks](https://www.worldoftrucks.com/) の公開プロフィールページをスクレイピングし、
プレーヤー統計を SQLite データベースに保存して「Global Total Distance 上位1000位」の
ランキングボードを表示する非公式ツールです。

> ⚠️ SCS Software / World of Trucks とは無関係の非公式ツールです。サイトへの負荷軽減のため
> 更新頻度を厳しく制限しています（下記「レート制限」参照）。ページ構造(HTML)が変わると
> スクレイパーは動かなくなります。

## 主な機能

- プロフィールURL末尾の数字ID (`https://www.worldoftrucks.com/en/profile/{ID}`) からデータを取得
- SQLite (`better-sqlite3`) にプレーヤー統計を保存
- **ランキング母集団は Global Total Distance の上位1000位で固定**。
  Euro / American の成績がどれだけ良くても、Global距離が1000位以内に入らない限り一切表示されません。
- 表示モード切り替え: `Global` / `Euro` / `American`（列の値がモードごとに切り替わります。母集団は変わりません）
- 各列ヘッダをクリックしてソート（昇順/降順トグル）
- 距離の単位切り替え（km / mi）をフロントエンドで実施
- Average Distance = Total Distance ÷ Total Jobs（小数点第1位）
- Average Speed = Total Distance ÷ Time on Duty（時間換算、小数点第1位）
- 各行右端に「更新」ボタン（クールダウン中は無効化されカウントダウン表示）
- 新規プレーヤー登録フォーム（誰でも自分のIDを入力して追加可能）

## レート制限（サイト負荷軽減のため）

| 操作 | 制限 |
|---|---|
| 同一プレーヤーの再取得（更新ボタン） | 8時間に1回まで |
| 新規プレーヤーの追加 | サイト全体で5分に1回まで |

制限はサーバー側 (`src/routes.js`) で強制されます。フロントエンドの表示はあくまで補助であり、
実際の可否はAPIレスポンス（HTTP 429 + `retry_after_ms`）で判定してください。

## セットアップ

```bash
npm install
npm start
# -> http://localhost:3000
```

環境変数（任意）:

- `PORT` : 待受ポート（デフォルト 3000）
- `DATA_DIR` : SQLiteファイルの保存先ディレクトリ（デフォルト `./data`）

## ディレクトリ構成

```
wot-leaderboard/
├── server.js            Express エントリポイント
├── src/
│   ├── scraper.js        プロフィールページ取得 + パース (axios + cheerio)
│   ├── parse.js           文字列→数値/距離/時間の変換ユーティリティ
│   ├── db.js              SQLite スキーマ & CRUD (better-sqlite3)
│   └── routes.js          REST API（レート制限含む）
├── public/
│   ├── index.html         画面
│   ├── style.css
│   └── app.js             ソート/モード切替/単位切替/更新ボタン等のロジック
└── data/                  SQLiteファイル（.gitignore対象、初回起動時に自動生成）
```

## スクレイピング対象（XPathの対応関係）

ユーザー提供のXPathに基づき、`div` の子要素インデックスをそのまま辿る実装にしています
（World of Trucks が class名を持たないレイアウトのため）。

| データ | 取得元 |
|---|---|
| プレーヤー名 | `body/div[1]/div/div[2]/h2/a[1]` |
| 国コード | `.../h2/a[2]/img[@src]` の `/img/flags/xxx.png` の `xxx` |
| Total Jobs | `body/div[1]/div/div[7]/div[2]/div[4]`（Euro=`div[2]`, American=`div[3]`） |
| Time on Duty | `body/div[1]/div/div[7]/div[3]/div[4]` |
| Total Mass | `body/div[1]/div/div[7]/div[4]/div[4]` |
| Total Distance | `body/div[1]/div/div[7]/div[7]/div[4]` |

値が `"-"` の場合は 0 として保存されます。距離は `km` / `mi` どちらの表記でも取得時に
**km に正規化して保存**し、表示側で単位変換します。

⚠️ World of Trucks が将来HTML構造を変更した場合、`src/scraper.js` のインデックスを
調整する必要があります。取得値が全項目0だった場合はレイアウト変化の疑いとしてエラーを
返すようにしています（サイレントに壊れたデータが保存されるのを防止）。

## API

- `GET  /api/leaderboard` — 上位1000位のデータ一式を返却（フロントでソート/モード/単位を適用）
- `GET  /api/players/:id` — 単体プレーヤー情報
- `POST /api/players` `{ "id": 1234567 }` — 新規プレーヤー登録（5分に1回まで）
- `POST /api/players/:id/refresh` — 既存プレーヤーの再取得（8時間に1回まで）

## GitHub / 本番デプロイ

1. このフォルダをそのまま git リポジトリにしてください:
   ```bash
   git init
   git add .
   git commit -m "Initial commit: World of Trucks leaderboard"
   git remote add origin <your-repo-url>
   git push -u origin main
   ```
2. Node.js が動くホスティング（Render / Railway / Fly.io / VPS 等）にデプロイしてください。
   `better-sqlite3` はネイティブビルドを含むため、ビルド環境に `python3` / `make` / `gcc`
   （Linuxイメージなら通常同梱）が必要です。
3. SQLiteファイルは `data/` ディレクトリに永続化されます。**ホスティング先が
   エフェメラルなファイルシステムの場合（例: 一部のサーバーレス環境）はデータが消えるため、
   永続ボリュームを持つプラン/サービスを選んでください。**
4. 静的ホスティングのみ（GitHub Pages等）では動きません。スクレイピングと
   レート制限の状態管理にサーバーサイド実行が必須のため、Node.jsサーバーが起動できる
   ホストを利用してください。

## 国旗画像のキャッシュ

`GET /flags/{code}.png` というエンドポイント（`src/flags.js`）を用意しています。

- 初回リクエスト時に World of Trucks (`/img/flags/{code}.png`) から取得し、
  `data/flags/` にPNGとして保存
- 2回目以降はローカルキャッシュから返却（Worldoftrucksへは二度とアクセスしない）
- 同じ国コードへの同時リクエストは1回のダウンロードにまとめる（多重取得防止）
- ブラウザ側にも `Cache-Control: public, max-age=604800` を付与
- プレーヤー登録・更新の直後にも該当国旗をバックグラウンドで先読みキャッシュ

フロントエンド (`public/app.js`) は `https://www.worldoftrucks.com/img/flags/...` への
ホットリンクではなく、自サーバーの `/flags/{code}.png` を参照するようになっています。

## セキュリティ / 攻撃耐性

想定される攻撃パターンごとの対策状況です。

| 攻撃 | 対策 |
|---|---|
| **SQLインジェクション** | すべてのクエリを `better-sqlite3` のプリペアドステートメント（`?` / 名前付き `@param`）で実行。文字列連結でSQLを組み立てている箇所はありません。 |
| **XSS（スクリプト注入）** | フロントエンドで動的に挿入する文字列（プレーヤー名・国名など）はすべて `escapeHtml()` を通してからDOMに挿入。ステータスメッセージは `textContent` を使用（HTMLとして解釈されない）。サーバー側は `helmet` によりCSP（`script-src 'self'` など）を送出し、インラインscript実行や外部script読み込みを拒否。 |
| **ボタンの改造（開発者ツールでdisabled属性を外す等）** | クライアント側の「更新ボタン無効化」はUI上の目安に過ぎません。実際の可否は**サーバー側**（`src/routes.js`）がDBの`last_updated`・`meta`テーブルを見て毎回判定するため、ボタンを有効化してリクエストを直接送っても、まだクールダウン中であれば`429`が返るだけで更新は実行されません。 |
| **レート制限のバイパス（同時多発リクエストによる競合状態）** | 旧実装ではチェックと記録の間に非同期の隙間があり、ほぼ同時に届いた複数リクエストが両方ともチェックを通過できる可能性がありました。現在は外部への取得を始める**前**に予約（reserve）してから実行するよう変更し、この隙間を解消。加えて同一プレーヤーへの同時多重リフレッシュも `refreshInFlight` セットで防止。 |
| **失敗リクエストによるレート制限回避（DoS増幅）** | 存在しないIDへの登録試行を大量に送りつけても、失敗時にも5分間のロックが消費されるように変更済み。これにより無限に外部サイトへリクエストを飛ばし続けることはできません。 |
| **APIへのリクエスト洪水（フラッド/DoS）** | `express-rate-limit` により、全API共通で1IPあたり60req/分、`/api/players`系（新規登録・更新）は1IPあたり5req/分に制限。 |
| **パストラバーサル** | `/flags/:file` は正規表現 `^[a-zA-Z0-9_-]{1,10}\.png$` で厳格に検証。`../` 等を含む値は即404で、ファイルシステム上のパス構築に使われる前に弾かれます。 |
| **SSRF（サーバーに任意URLを取得させる）** | スクレイパーが叩くURLは `https://www.worldoftrucks.com/en/profile/{id}` に固定。`id` は事前に「1以上、上限値以下の整数」であることをサーバー側で検証してから埋め込むため、URLやホスト名を外部から操作する余地はありません。 |
| **不正な巨大リクエストボディ** | `express.json({ limit: '2kb' })` でボディサイズを制限（想定ペイロードは `{ id: 数値 }` のみ）。 |
| **エラー時の情報漏洩（スタックトレース等）** | グローバルエラーハンドラを追加し、`NODE_ENV` の設定に関わらず常に汎用エラーメッセージのみを返却（詳細はサーバーログにのみ出力）。不正なJSONボディも同様にクリーンな400になります。 |
| **HTTPセキュリティヘッダ不足** | `helmet` を導入し、CSP / `X-Content-Type-Options` / `X-Frame-Options` / HSTS等を付与。`X-Powered-By: Express` ヘッダも削除。 |
| **CSRF** | 現状は未対策ですが、本アプリの「新規プレーヤー登録」「更新」は元々認証なしで誰でも実行できる公開アクションであり、CSRFで第三者が到達できたとしても本人が直接叩けること以上の被害はありません（優先度は低いと判断）。将来ログイン機能などを追加する場合は別途対策が必要です。 |

### 既知の制限（多重プロセス/マルチインスタンス運用時の注意）

競合状態対策の一部（`newPlayerLockUntil` / `refreshInFlight`）はNode.jsプロセス内のメモリで
管理しています。**単一プロセスでの運用（前提の構成）であれば問題ありません**が、PM2の
cluster modeや複数インスタンスを立てて運用する場合はこのメモリロックがプロセス間で
共有されないため、レース条件の窓が広がります（SQLiteファイル自体も複数プロセスからの
同時書き込みには不向きです）。スケールさせたい場合は、Redis等の外部ストアによる
分散ロック・レート制限に置き換えることを推奨します。



- 国旗の元データは World of Trucks 本家のPNGです。存在しない/不正なコードの場合は404を
  返し、フロントエンド側で画像を非表示にします。
- Total Mass の単位はトン(t)固定です。ポンド/USトン表示が必要な場合は `app.js` の
  `fmtMass` を拡張してください。
- 現状は手動更新のみです。定期的な自動更新（例: 1日1回のcronジョブで全登録プレーヤーを
  巡回）を追加する場合は、レート制限（8時間ルール）を守るスケジューラを別途実装してください。
#   W o r l d - o f - T r u c k s - T o p - 1 0 0 0  
 