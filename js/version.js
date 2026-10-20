// アプリのバージョンと更新履歴(ヘルプ画面に表示する)。
// リリースのたびに先頭へ 1 件追加し、sw.js の CACHE_VERSION を `coffee-v<version>` に合わせる
// (tools/verify.mjs の version が一致を検査する)。
// バージョンの付け方: 機能の追加・変更は 2 桁目、不具合修正だけなら 3 桁目を上げる。

export const CHANGELOG = [
  {
    version: '1.3.0',
    date: '2026-10-20',
    changes: ['ヘルプにバージョンと更新履歴を表示'],
  },
  {
    version: '1.2.0',
    date: '2026-10-20',
    changes: ['ダッシュボードに「1日あたり平均」を追加(今の期間は開始日から今日までの日数で計算)'],
  },
  {
    version: '1.1.1',
    date: '2026-10-12',
    changes: ['更新後も古い画面が表示され続けることがある不具合を修正'],
  },
  {
    version: '1.1.0',
    date: '2026-10-12',
    changes: ['起動時の画面をダッシュボードに変更', '「記録する」ボタンを下部中央の丸ボタンに変更'],
  },
  {
    version: '1.0.0',
    date: '2026-10-12',
    changes: ['最初の公開版(記録・ダッシュボード・履歴・設定・CSVバックアップ・オフライン対応)'],
  },
];

export const APP_VERSION = CHANGELOG[0].version;
