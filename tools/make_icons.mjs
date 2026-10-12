// アイコン PNG の生成(icons/icon.svg → icons/*.png)。Playwright(Chromium)が必要。
// 使い方: node tools/make_icons.mjs icons/icon.svg icons
// Playwright の場所が違う場合は環境変数 PLAYWRIGHT_MODULE で指定する。
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
import fs from 'node:fs';
const [svgPath, outDir] = process.argv.slice(2);
const svg = fs.readFileSync(svgPath, 'utf8');
const inner = svg.replace(/^[\s\S]*?<svg[^>]*>/, '').replace(/<\/svg>\s*$/, '').replace(/<!--[\s\S]*?-->/g, '');
const maskable = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512"><rect width="512" height="512" fill="#6f4e37"/><g transform="translate(256 256) scale(0.72) translate(-256 -256)">${inner.replace(/<rect width="512" height="512" rx="112" fill="#6f4e37"\/>/, '')}</g></svg>`;
const b = await chromium.launch();
for (const [name, src, size] of [['icon-192.png', svg, 192], ['icon-512.png', svg, 512], ['icon-maskable-512.png', maskable, 512]]) {
  const p = await b.newPage({ viewport: { width: size, height: size } });
  await p.setContent(`<html><body style="margin:0;background:transparent">${src.replace('<svg ', `<svg width="${size}" height="${size}" `)}</body></html>`);
  await p.screenshot({ path: `${outDir}/${name}`, omitBackground: true });
  await p.close();
}
await b.close();
