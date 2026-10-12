---
name: verify
description: Use when the user runs "/verify", or when any coffee-ledger task's verification phase needs to delegate to the verifier subagent and report the result as a PASS/FAIL table.
---

# verify — verifier への定型委譲と報告整形

検証を実際に行うのは `verifier` サブエージェント。このスキルは呼び出し方と報告の形式を定める。検証コマンドの中身は `rules/verification.md` §必須検証フローが正本(ここには書き写さない)。

## 手順

1. **検証対象の確認**: 今回変更したファイル一覧(実装報告、または `git diff --stat`)と、「何が確認できれば今回の変更が効いたと言えるか」の判定条件を揃える。無ければ先に確認する。
2. **`verifier` へ委譲する**(同期実行)。プロンプトの型:

   > 「`rules/verification.md` の §必須検証フロー に従って検証してください(あなたが自分で Read すること)。基本は `node tools/verify.mjs --e2e` を 1 回実行し、JSON を読んでください。今回の変更対象は `<ファイル一覧>`、効いたと言える判定条件は `<条件>` です。コードは修正せず、観測した事実だけを、verifier 定義の報告形式(PASS/FAIL 表)で日本語で報告してください。」

3. **報告を PASS/FAIL 表へ整形する**: verifier の表(test / syntax / relative_paths / unique_ids / precache / sw_version / e2e / 判定条件)をそのまま使い、「未実施(理由)」は FAIL と区別する。表の下に FAIL/未実施の要点だけを箇条書きで添える(ログの生出力は貼らない)。
4. **判定**: 全項目 PASS(未実施は理由が妥当なもののみ許容)なら検証完了として扱い、作業ブランチへの push を確認なしで行ってよい(`CLAUDE.md` §14.5)。FAIL があれば `full_loop` 手順 4 の差し戻しへ進む。
