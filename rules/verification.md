# 検証ルール (Verification Rules)

正本。`verifier` はこのファイルを自分で Read して検証する。

## 必須検証フロー

> 出力は必ず絞る: まず `tools/verify.mjs` の JSON サマリだけを読み、**失敗した項目だけ**詳細を取り直す。

0. **一括検証(まずこれを使う)**: `node tools/verify.mjs`(ブラウザ検証込みは `node tools/verify.mjs --e2e`)。標準出力に JSON 1 つ(`ok` と `checks`)を返し、進捗は標準エラー。終了コードは全項目 OK で 0。
   | キー | 内容 |
   |---|---|
   | `test` | `npm test` 相当(`node --test "tests/*.test.js"`)。`passed`/`failed`、失敗時は `failures` |
   | `syntax` | `js/*.js`・`sw.js` の `node --check` |
   | `relative_paths` | `index.html` の src/href・manifest の `start_url`/`scope`/icons・`sw.js` の `APP_SHELL`・JS の import/register/fetch に `/` 始まりの絶対パスが無いこと(§2 サブパス配信) |
   | `unique_ids` | `index.html` 内の `id` 属性に重複が無いこと(L3) |
   | `precache` | `APP_SHELL` の全ファイルが存在し、`css/` `js/` `vendor/` `icons/` の配信アセットがすべて `APP_SHELL` に入っていること |
   | `sw_version` | 比較元(既定 `origin/main`)からアプリシェルが変わっているのに `CACHE_VERSION` が同じなら NG。比較元が無ければ `skipped` |
   | `e2e` | `--e2e` 指定時のみ。`tools/e2e_smoke.mjs` の結果(下記 2) |
1. **ユニットテスト**: 集計・CSV のロジックを変えたら `tests/*.test.js` に対応するテストを追加する。§10 の自動テスト項目を削らない。
2. **ブラウザ検証(E2E スモーク)**: `node tools/e2e_smoke.mjs` が `/coffee-ledger/` サブパスでローカル配信し、ヘッドレス Chromium(幅 360px)で記録(4 操作・店プルダウン・重複防止・カフェ店 0 件)・直近金額・クイック入力と元に戻す・ダッシュボード自動更新とグラフ・履歴削除・オフライン起動・横スクロール無し・コンソールエラー無しを確認する。Playwright が無い環境では `skipped` を返す(その場合は手動のブラウザ確認で代替し、未実施と報告する)。
   - Playwright の場所は環境変数 `PLAYWRIGHT_MODULE`(例: `/opt/node-tools/node_modules/playwright/index.mjs`)、Chromium は `CHROMIUM_PATH` で指定できる。
3. **画面を変えた場合の目視**: 変更した画面だけ、幅 360px のライト/ダーク各 1 枚のスクリーンショットで崩れ・はみ出し・部分英語が無いことを確認する(スクリーンショットは要所のみ)。
4. **手動確認(ユーザーが Android 実機で実施)**: §10 の 7 項目。GitHub Pages 公開後に行う。

## 既知の失敗しやすい検証経路
- `node --test tests/` のディレクトリ指定は Node 22 で失敗する。必ず glob(`"tests/*.test.js"`)を使う(L1)。
- Service Worker の更新・オフライン検証は、同一ブラウザコンテキストで `reload` を挟んで SW の制御下に入ってから `setOffline(true)` する。初回ロード直後はまだ制御下に無い。
- SW の更新検証はローカルの no-cache 配信では再現しない問題がある。`Cache-Control: max-age=600`(GitHub Pages と同じ)で配信し、旧版→新版の差し替えを確認する(L4)。
- ローカル配信はルートではなく `/coffee-ledger/` のようなサブパスで行う(GitHub Pages と同条件にしないと絶対パスの誤りを見逃す)。

## コーディング規約
- ビルド工程なし・フレームワークなし・外部 CDN なし(§2)。ライブラリは `vendor/` に同梱し、版とライセンスを `vendor/README.md` に書く。
- `aggregate.js` は純粋関数のみ(DOM・DB 非依存)。日付は `YYYY-MM-DD` 文字列のまま扱い、`Date` のタイムゾーン変換を通さない。
- UI 文言は全文日本語。金額表示は `¥1,234`(`Intl.NumberFormat('ja-JP')` + 半角 ¥)。
- `id` 属性は画面をまたいで一意にする(全画面が 1 つの `index.html` に同居するため。L3)。
- アセットを変えたら `sw.js` の `CACHE_VERSION` を上げる。

## 教訓インデックス (Lessons Learned)

全文は `rules/lessons_archive.md`(`L<番号>` で grep)。ここには 1 行見出しのみ(1 行 120 バイト以内)。

### テスト・ツール
- L1 node --test にディレクトリを渡すと Node 22 では失敗する

### PWA / Service Worker
- L2 初回インストール時の clients.claim でも controllerchange が発火する
- L4 SWのcache.addAllはHTTPキャッシュ経由。Pagesのmax-age=600で旧版を固定する

### UI / DOM
- L3 単一HTMLに全画面を置くとid重複で別画面の要素を掴む
