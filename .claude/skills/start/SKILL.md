---
name: start
description: This skill should be used when the user runs "\start" or "/start", or asks to begin/resume a daily development loop session for this project (coffee-ledger). Syncs the branch and surfaces today's candidate task from the master plan and session handover notes.
---

# start — 日次ループのセッション開始

coffee-ledger の日次改修ループ(`CLAUDE.md` §14.3)の起点。実装には入らず、状況確認とタスク候補の提示までを行う。

## 手順

1. **git 同期の確認**: `git status --short` と `git fetch origin` → `git status -sb` で、未コミットの変更・origin との差分を確認する。未コミット変更や競合があれば内容を報告して止まる(自分で stash/reset/checkout しない)。
2. **検証の健全性**: `node tools/verify.mjs` を実行し、`ok:false` なら失敗項目を報告する(前回の残骸で壊れていないかの確認。E2E は付けない)。
3. `NEXT_SESSION.md` の「1. 現状サマリ」「2. 次回の着手点」を読み、引き継ぎ事項を把握する。
4. `docs/改修マスタープラン.md` §3 は全文を読まず、`grep -n "| ⬜ |" docs/改修マスタープラン.md` で未完了行だけを抽出し、「依存が満たされた最上位のタスク」(依存がすべて ✅ で、表内で最も上にあるもの)を特定する。依存の完了確認は「完了済み」行と `docs/archive/マスタープラン_完了タスク.md` を ID で grep する。
5. 当日の候補タスクを 1 つ提示する(`NEXT_SESSION.md` の推奨と一致すればそれ、食い違えば理由とともに両論併記)。ID・内容・依存・サイズ・「実装+検証まで 1 ループに収まるか」の一言見積もりを含め、**`AskUserQuestion` の選択式で着手してよいか確認する**(候補が「⚠️ユーザー実施」だけならその旨を伝え、ユーザーの作業状況を選択式で尋ねる)。

## 注意

- 読むファイルは `CLAUDE.md` §14.1 の最小セットに従う。アーカイブ類は全読みしない。
- このスキル自体は実装しない。承認後の実装・検証は担当サブエージェントへ委譲する(`/full_loop` スキル §サブエージェントへの委譲)。
