# 教訓アーカイブ

`rules/verification.md` の教訓インデックスの全文。追記は末尾に `### L<最大番号+1> <見出し>` + 空行 + 本文の形式で行う。

### L1 node --test にディレクトリを渡すと Node 22 では失敗する

- **事象**: 仕様 §3 どおり `"test": "node --test tests/"` にすると、Node 22.22 で `Error: Cannot find module '/…/tests'` になりテストが 1 件も走らない(2026-10-12)。
- **原因**: Node 21 以降の `node --test` は位置引数を glob パターンとして解釈し、ディレクトリ名はファイルとして読み込もうとする。
- **対処**: `node --test "tests/*.test.js"` と glob をクォートして渡す(Windows のシェルでも Node 側で展開される)。ディレクトリ内の補助ファイル(`fixtures.js`)をテストとして実行しない効果もある。

### L2 初回インストール時の clients.claim でも controllerchange が発火する

- **事象**: 「更新があります(再読み込み)」実装で `controllerchange` を受けたら無条件に `location.reload()` していたため、初回訪問時に SW の `activate` → `clients.claim()` で画面が勝手に再読み込みされた(E2E で「Execution context was destroyed」として検出、2026-10-12)。
- **対処**: ユーザーが再読み込みボタンを押したとき(`SKIP_WAITING` を送ったとき)だけフラグを立て、そのフラグがあるときだけ再読み込みする。入力途中のフォームが消える事故を防ぐ。

### L3 単一HTMLに全画面を置くとid重複で別画面の要素を掴む

- **事象**: 設定画面の店追加ボタンに記録画面の店追加欄と同じ `id="store-add"` を付けたため、`getElementById` が記録画面の `div` を返し、設定画面の追加ボタンが反応しなかった(E2E で検出、2026-10-12)。
- **対処**: 画面ごとに接頭辞(設定は `set-`)を付ける。検証時は `index.html` の id 重複を機械的に確認する。

### L4 SWのcache.addAllはHTTPキャッシュ経由。Pagesのmax-age=600で旧版を固定する

- **事象**: 起動画面の変更を `main` へ反映し `CACHE_VERSION` も上げたのに、実機で「変わらない」。新しい SW はインストール・有効化され `coffee-v2` のキャッシュもできていたが、中身が旧版の `index.html`/`app.js` だった(2026-10-12)。
- **原因**: `cache.addAll(urls)` はブラウザの HTTP キャッシュを通常どおり使う。GitHub Pages は `Cache-Control: max-age=600` を返すため、直前 10 分以内に読み込んだ旧版がそのまま新しいキャッシュに入り、cache-first 配信で旧版が固定される。E2E はローカルの `no-cache` 配信だったため再現しなかった。
- **対処**: プリキャッシュは `new Request(url, { cache: 'reload' })` で HTTP キャッシュを迂回する(`tools/verify.mjs` の `precache` が検査)。更新の検証は max-age=600 の配信で旧版→新版を差し替えて行う。あわせて、登録完了前に始まった更新を取り逃さないよう `reg.installing`/`reg.waiting` も監視する。
