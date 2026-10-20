// 一括検証スクリプト。結果を JSON 1 つで標準出力に返す(進捗は標準エラー)。
// 使い方: node tools/verify.mjs [--base <ref>] [--e2e]
//   --base  : SW キャッシュ版の上げ忘れ判定の比較元(既定: origin/main、無ければ判定をスキップ)
//   --e2e   : tools/e2e_smoke.mjs(Playwright)も実行する
// 正本の手順は rules/verification.md §必須検証フロー。
import { execFileSync, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const baseRef = args.includes('--base') ? args[args.indexOf('--base') + 1] : 'origin/main';
const runE2e = args.includes('--e2e');
const read = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8');
const exists = (f) => fs.existsSync(path.join(ROOT, f));
const checks = {};

function git(...a) {
  return execFileSync('git', a, { cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
}

// 1. ユニットテスト
{
  process.stderr.write('[verify] npm test\n');
  const r = spawnSync(process.execPath, ['--test', 'tests/*.test.js'], { cwd: ROOT, encoding: 'utf8' });
  const out = `${r.stdout}${r.stderr}`;
  const num = (k) => Number((out.match(new RegExp(`^# ${k} (\\d+)`, 'm')) || [])[1] ?? NaN);
  checks.test = { ok: r.status === 0, passed: num('pass'), failed: num('fail') };
  if (r.status !== 0) checks.test.failures = out.split('\n').filter((l) => /^\s*not ok/.test(l)).slice(0, 20);
}

// 2. 構文チェック
const jsFiles = ['sw.js', ...fs.readdirSync(path.join(ROOT, 'js')).filter((f) => f.endsWith('.js')).map((f) => `js/${f}`)];
{
  const bad = [];
  for (const f of jsFiles) {
    const r = spawnSync(process.execPath, ['--check', f], { cwd: ROOT, encoding: 'utf8' });
    if (r.status !== 0) bad.push({ file: f, error: r.stderr.split('\n').slice(0, 5).join('\n') });
  }
  checks.syntax = { ok: bad.length === 0, files: jsFiles.length, ...(bad.length ? { errors: bad } : {}) };
}

// 3. 絶対パス禁止(GitHub Pages のサブパス配信、仕様 §2)
const shellMatch = read('sw.js').match(/APP_SHELL\s*=\s*\[([\s\S]*?)\]/);
const appShell = shellMatch ? [...shellMatch[1].matchAll(/'([^']+)'/g)].map((m) => m[1]) : [];
{
  const found = [];
  const html = read('index.html');
  for (const m of html.matchAll(/(?:src|href)="([^"]+)"/g)) if (m[1].startsWith('/')) found.push(`index.html: ${m[1]}`);
  const man = JSON.parse(read('manifest.webmanifest'));
  for (const k of ['start_url', 'scope']) if (String(man[k]).startsWith('/')) found.push(`manifest.${k}: ${man[k]}`);
  for (const i of man.icons || []) if (i.src.startsWith('/')) found.push(`manifest.icons: ${i.src}`);
  for (const s of appShell) if (!s.startsWith('./')) found.push(`sw.js APP_SHELL: ${s}`);
  for (const f of jsFiles) {
    for (const m of read(f).matchAll(/(?:import\s*\(|from\s+|register\(|fetch\(|cache\.match\()\s*['"`](\/[^'"`]*)/g)) found.push(`${f}: ${m[1]}`);
  }
  checks.relative_paths = { ok: found.length === 0, ...(found.length ? { absolute: found } : {}) };
}

// 3b. id の重複(全画面が index.html に同居するため。教訓 L3)
{
  const ids = [...read('index.html').matchAll(/\sid="([^"]+)"/g)].map((m) => m[1]);
  const dup = [...new Set(ids.filter((id, i) => ids.indexOf(id) !== i))];
  checks.unique_ids = { ok: dup.length === 0, ...(dup.length ? { duplicates: dup } : {}) };
}

// 4. プリキャッシュ対象の過不足
{
  const missing = appShell.filter((s) => s !== './' && !exists(s));
  const assets = [
    'index.html',
    'manifest.webmanifest',
    ...['css', 'js', 'vendor', 'icons'].flatMap((d) =>
      exists(d)
        ? fs
            .readdirSync(path.join(ROOT, d))
            .filter((f) => /\.(css|js|png|webmanifest)$/.test(f))
            .map((f) => `${d}/${f}`)
        : [],
    ),
  ];
  const notCached = assets.filter((a) => !appShell.includes(`./${a}`));
  // プリキャッシュは HTTP キャッシュを経由しないこと(教訓 L4)
  const bypassHttpCache = /cache:\s*'reload'/.test(read('sw.js'));
  checks.precache = { ok: missing.length === 0 && notCached.length === 0 && bypassHttpCache, entries: appShell.length };
  if (!bypassHttpCache) checks.precache.note = "sw.js のプリキャッシュに cache: 'reload' がありません(L4)";
  if (missing.length) checks.precache.missing_files = missing;
  if (notCached.length) checks.precache.not_in_app_shell = notCached;
}

// 5. アセット変更時の SW キャッシュ版の上げ忘れ(仕様 §8)
{
  const curVersion = (read('sw.js').match(/CACHE_VERSION\s*=\s*'([^']+)'/) || [])[1] ?? null;
  let base = null;
  try {
    base = git('merge-base', 'HEAD', baseRef);
  } catch {
    base = null;
  }
  if (!base) {
    checks.sw_version = { ok: true, skipped: true, note: `比較元 ${baseRef} が無いため判定をスキップ`, version: curVersion };
  } else {
    let baseVersion = null;
    try {
      baseVersion = (git('show', `${base}:sw.js`).match(/CACHE_VERSION\s*=\s*'([^']+)'/) || [])[1] ?? null;
    } catch {
      baseVersion = null;
    }
    const changed = git('diff', '--name-only', base, '--', ...appShell.filter((s) => s !== './').map((s) => s.slice(2)))
      .split('\n')
      .filter(Boolean);
    // 上の diff は作業ツリーとの比較なので未コミットの変更も含む。未追跡の新規アセットはここで拾う
    const dirty = git('ls-files', '--others', '--exclude-standard', '--', 'index.html', 'manifest.webmanifest', 'css', 'js', 'vendor', 'icons')
      .split('\n')
      .filter(Boolean);
    const touched = [...new Set([...changed, ...dirty])];
    const needBump = baseVersion !== null && touched.length > 0;
    checks.sw_version = {
      ok: !needBump || curVersion !== baseVersion,
      base: baseRef,
      baseVersion,
      version: curVersion,
      changedAssets: touched.length,
    };
    if (needBump && curVersion === baseVersion) checks.sw_version.note = 'アプリシェルが変更されていますが CACHE_VERSION が上がっていません';
  }
}

// 5b. 更新履歴の最新バージョンと SW キャッシュ名の一致(js/version.js)
if (exists('js/version.js')) {
  const latest = (read('js/version.js').match(/version:\s*'([^']+)'/) || [])[1] ?? null;
  const cache = (read('sw.js').match(/CACHE_VERSION\s*=\s*'([^']+)'/) || [])[1] ?? null;
  checks.version = { ok: latest !== null && cache === `coffee-v${latest}`, latest, cache };
  if (!checks.version.ok) checks.version.note = 'js/version.js の先頭の version と sw.js の CACHE_VERSION(coffee-v<version>)を揃えてください';
}

// 6. E2E スモーク(任意)
if (runE2e) {
  process.stderr.write('[verify] e2e smoke\n');
  const r = spawnSync(process.execPath, ['tools/e2e_smoke.mjs'], { cwd: ROOT, encoding: 'utf8', timeout: 180000 });
  try {
    checks.e2e = JSON.parse(r.stdout.trim().split('\n').pop());
  } catch {
    checks.e2e = { ok: false, error: (r.stderr || r.stdout || '').split('\n').slice(-10).join('\n') };
  }
}

let head = null;
try {
  head = git('rev-parse', '--short', 'HEAD');
} catch {
  head = null;
}
const ok = Object.values(checks).every((c) => c.ok);
process.stdout.write(`${JSON.stringify({ ok, head, ranAt: new Date().toISOString(), checks }, null, 2)}\n`);
process.exit(ok ? 0 : 1);
