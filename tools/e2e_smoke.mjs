// E2E スモークテスト(ヘッドレス Chromium)。結果を JSON 1 行で標準出力に返す。
// GitHub Pages と同じくサブパス(/coffee-ledger/)で配信し、主要な操作を一通り確認する。
// 必要: Playwright(npm の playwright。場所が違う場合は環境変数 PLAYWRIGHT_MODULE で指定)。
// Chromium の実行ファイルを指定する場合は CHROMIUM_PATH を設定する。
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const BASE = '/coffee-ledger/';
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.webmanifest': 'application/manifest+json', '.svg': 'image/svg+xml' };

let chromium;
try {
  ({ chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright'));
} catch {
  process.stdout.write(`${JSON.stringify({ ok: true, skipped: true, note: 'Playwright が見つからないため未実施' })}\n`);
  process.exit(0);
}

const server = http.createServer((req, res) => {
  const url = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  if (!url.startsWith(BASE)) {
    res.writeHead(404).end();
    return;
  }
  let file = path.join(ROOT, url.slice(BASE.length) || 'index.html');
  if (!file.startsWith(ROOT)) {
    res.writeHead(403).end();
    return;
  }
  if (fs.existsSync(file) && fs.statSync(file).isDirectory()) file = path.join(file, 'index.html');
  if (!fs.existsSync(file)) {
    res.writeHead(404).end();
    return;
  }
  res.writeHead(200, { 'Content-Type': TYPES[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-cache' });
  fs.createReadStream(file).pipe(res);
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const URL_ = `http://127.0.0.1:${server.address().port}${BASE}`;

const results = [];
const errors = [];
const check = (name, ok, detail = '') => results.push({ name, ok: Boolean(ok), ...(detail !== '' ? { detail: String(detail) } : {}) });

const browser = await chromium.launch(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {});
try {
  const ctx = await browser.newContext({ viewport: { width: 360, height: 740 } });
  const p = await ctx.newPage();
  p.on('pageerror', (e) => errors.push(e.message));
  p.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
  p.on('dialog', (d) => d.accept());
  const count = () => p.evaluate(async () => (await (await import('./js/db.js')).getAll('entries')).length);

  await p.goto(URL_);
  await p.waitForSelector('#dash-empty:not([hidden])');
  check('起動時の画面はダッシュボード', (await p.textContent('#page-title')) === 'ダッシュボード' && (await p.isHidden('#view-record')));
  const fab = await p.$eval('.tab-record .tab-icon', (el) => {
    const r = el.getBoundingClientRect();
    const bar = document.querySelector('.tabbar').getBoundingClientRect();
    return { cx: r.left + r.width / 2, w: innerWidth, raised: r.top < bar.top, size: Math.min(r.width, r.height) };
  });
  check('「記録する」ボタンが下部中央に浮いて表示', Math.abs(fab.cx - fab.w / 2) < 2 && fab.raised && fab.size >= 44, JSON.stringify(fab));
  await p.click('.tab-record');
  await p.waitForSelector('#type-chips .chip');
  await p.evaluate(() => navigator.serviceWorker?.ready);
  check('初期マスタ(種類5・区分4)', (await p.$$('#type-chips .chip')).length === 5 && (await p.$$('#cat-chips .chip')).length === 4);
  check('保存ボタンは必須項目が揃うまで無効', await p.isDisabled('#save-btn'));

  // 自宅: 種類→区分→金額→保存(4操作)
  await p.click('#type-chips .chip:has-text("ドリップ")');
  await p.click('#cat-chips .chip:has-text("自宅")');
  check('自宅では店のプルダウンを出さない', await p.isHidden('#store-area'));
  await p.fill('#amount', '0');
  await p.dispatchEvent('#amount', 'input');
  await p.click('#save-btn');
  await p.waitForSelector('#toast:not([hidden])');
  check('保存トースト', (await p.textContent('#toast-msg')) === '保存しました');

  // コンビニ: プルダウンと「＋ 新しく追加…」
  await p.click('#type-chips .chip:has-text("ドリップ")');
  await p.click('#cat-chips .chip:has-text("コンビニ")');
  const opts = await p.$$eval('#store-select option', (o) => o.map((x) => x.textContent));
  check('コンビニのプルダウン(先頭プレースホルダ・末尾に新規追加)', opts[0] === '店を選択' && opts.at(-1) === '＋ 新しく追加…', opts.join('/'));
  await p.selectOption('#store-select', '__new__');
  check('新規追加で入力欄が出てフォーカス', (await p.isVisible('#store-new-name')) && (await p.evaluate(() => document.activeElement.id)) === 'store-new-name');
  await p.fill('#store-new-name', ' ｾﾌﾞﾝ ');
  await p.click('#store-add-btn');
  check('同じ区分内の重複は追加せず既存を選択', (await p.$eval('#store-select', (s) => s.selectedOptions[0].textContent)) === 'セブン');
  await p.click('#store-cancel-btn');
  await p.selectOption('#store-select', { label: 'セブン' });
  await p.fill('#amount', '120');
  await p.dispatchEvent('#amount', 'input');
  await p.click('#save-btn');
  await p.waitForTimeout(150);

  // カフェ: 店 0 件なら入力欄を直接表示
  await p.click('#type-chips .chip:has-text("ラテ")');
  await p.click('#cat-chips .chip:has-text("カフェ")');
  check('カフェ(店0件)は入力欄を直接表示', (await p.isHidden('#store-select')) && (await p.isVisible('#store-new-name')));
  await p.fill('#store-new-name', 'テスト珈琲');
  await p.press('#store-new-name', 'Enter');
  await p.waitForTimeout(150);
  check('追加した店がプルダウンで選択される', (await p.$eval('#store-select', (s) => s.selectedOptions[0]?.textContent)) === 'テスト珈琲');
  await p.click('#cat-chips .chip:has-text("カフェ")');

  // 直近金額の自動入力
  await p.click('#type-chips .chip:has-text("ドリップ")');
  await p.click('#cat-chips .chip:has-text("コンビニ")');
  await p.selectOption('#store-select', { label: 'セブン' });
  check('種類＋店で直近金額を自動入力', (await p.inputValue('#amount')) === '120');

  // クイック入力 1 タップ → 元に戻す
  const n0 = await count();
  await p.click('.preset-main >> nth=0');
  await p.waitForTimeout(150);
  const n1 = await count();
  await p.click('#toast-action');
  await p.waitForTimeout(150);
  check('クイック入力1タップで保存・元に戻す', n1 === n0 + 1 && (await count()) === n0, `${n0}→${n1}`);

  // ダッシュボードの自動更新
  await p.click('.tab[data-view=dashboard]');
  const before = await p.textContent('#sum-total');
  await p.click('.tab[data-view=record]');
  await p.click('#same-as-last');
  await p.waitForTimeout(150);
  await p.click('.tab[data-view=dashboard]');
  const after = await p.textContent('#sum-total');
  check('保存後にダッシュボードが自動更新', before !== after, `${before}→${after}`);
  check('1日あたり平均を表示', /^¥[\d,]+$/.test(await p.textContent('#sum-perday')) && /^\d+日間で計算$/.test(await p.textContent('#sum-perday-sub')), await p.textContent('#sum-perday'));
  check('グラフ描画', await p.evaluate(() => typeof Chart === 'function' && !!Chart.getChart(document.getElementById('chart-series'))));

  // 履歴: 編集と削除
  await p.click('.tab[data-view=history]');
  const items = (await p.$$('.item')).length;
  await p.click('.item-del >> nth=0');
  await p.waitForTimeout(150);
  check('履歴から削除', (await p.$$('.item')).length === items - 1);
  await p.click('#toast-action');
  await p.waitForTimeout(150);

  // オフライン
  await p.reload();
  await p.waitForSelector('.tab-record');
  await ctx.setOffline(true);
  await p.reload();
  await p.waitForSelector('#dash-body:not([hidden])', { timeout: 5000 });
  await p.click('.tab[data-view=dashboard]');
  check('オフラインで起動・ダッシュボード表示', await p.evaluate(() => typeof Chart === 'function'));
  await ctx.setOffline(false);

  await p.click('#menu-btn');
  await p.click('#menu [data-view=help]');
  check('ヘルプにバージョンと更新履歴', /^\d+\.\d+\.\d+\(\d{4}\/\d{1,2}\/\d{1,2} 更新\)$/.test(await p.textContent('#app-version')) && (await p.$$('#changelog h3')).length >= 1, await p.textContent('#app-version'));
  check('横スクロールなし(幅360px)', !(await p.evaluate(() => document.documentElement.scrollWidth > innerWidth)));
  check('コンソールエラーなし', errors.length === 0, errors.slice(0, 5).join(' | '));
} catch (err) {
  check('実行', false, err.message.split('\n')[0]);
} finally {
  await browser.close();
  server.close();
}

const ok = results.every((r) => r.ok);
process.stdout.write(`${JSON.stringify({ ok, passed: results.filter((r) => r.ok).length, failed: results.filter((r) => !r.ok) })}\n`);
process.exit(ok ? 0 : 1);
